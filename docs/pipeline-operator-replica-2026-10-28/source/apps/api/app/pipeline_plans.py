"""Build deterministic execution plans without importing user-uploaded Python.

Debug is deliberately limited to audited inline document operators and
documents-only uploaded transforms in the existing network-disabled container.
Unknown trusted plugins are not made safe by their own side_effects flag.
"""

from copy import deepcopy
import hashlib
import json
from typing import Any

from .pipeline_runtime import validate_graph

DEBUG_LIMIT = 100
AUDITED_OPERATORS = {"documents.inline@1.0.0", "documents.filter@1.0.0"}


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False).encode()).hexdigest()


class PlanError(ValueError):
    def __init__(self, errors: list[str], blocked: list[dict] | None = None):
        super().__init__("; ".join(errors))
        self.errors, self.blocked = errors, blocked or []


def semantic_graph(graph: dict) -> dict:
    """Canvas coordinates and editor-only fields do not change execution."""
    return {"nodes": [{"id": node["id"], "operator": node["operator"], "version": node["version"],
        "config": deepcopy(node.get("config", {})), "inputs": deepcopy(node.get("inputs", {}))}
        for node in sorted(graph["nodes"], key=lambda item: item["id"])]}


def debug_blocked_reason(manifest: dict) -> str | None:
    from .documents_plugin import plugin
    audited_contracts = {operator.key: operator.manifest("documents.core", plugin().version)["implementation_digest"]
        for operator in plugin().operators}
    audited = (not manifest.get("release_id") and manifest.get("plugin_id") == "documents.core"
        and manifest.get("key") in AUDITED_OPERATORS
        and manifest.get("implementation_digest") == audited_contracts.get(manifest.get("key")))
    isolated_transform = (bool(manifest.get("release_id")) and manifest.get("kind") == "transform"
        and manifest.get("execution") == "isolated-container" and manifest.get("trust") == "validated-release"
        and manifest.get("execution_protocol") in {None, "dataset-v1"})
    document_inputs = manifest.get("input_ports") or ({"data": manifest.get("input_type")}
        if manifest.get("kind") != "source" else {})
    if (not (audited or isolated_transform) or manifest.get("side_effects")
            or manifest.get("output_type") != "documents"
            or any(value != "documents" for value in document_inputs.values())):
        return "小样本调试仅支持固定内联文档源、内置纯文档处理和隔离容器中的文档转换；不执行外部源或副作用节点"
    return None


def build_plan(graph: dict, snapshot: list[dict], *, version: int, mode: str = "production",
               targets: list[str] | None = None, sample_limit: int | None = None,
               use_cache: bool = True, environment_id: str | None = None,
               worker_pool_id: str | None = None, execution_binding: dict | None = None) -> dict:
    manifests = {item["key"]: item for item in snapshot}
    validation = validate_graph(graph, set(manifests), manifests)
    if not validation["valid"]:
        raise PlanError(validation["errors"])
    if mode not in {"production", "debug"}:
        raise PlanError(["未知运行模式"])
    nodes = {node["id"]: node for node in graph["nodes"]}
    if mode == "production":
        if targets or sample_limit is not None:
            raise PlanError(["正式运行不支持目标节点或小样本限制"])
        chosen = set(nodes)
        target_ids = [node_id for node_id in validation["order"]
            if not any(node_id in node.get("inputs", {}).values() for node in nodes.values())]
        limit = None
    else:
        target_ids = sorted(set(targets or []))
        if not target_ids or any(target not in nodes for target in target_ids):
            raise PlanError(["请选择保存版本中存在的目标节点"])
        limit = 20 if sample_limit is None else sample_limit
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= DEBUG_LIMIT:
            raise PlanError([f"小样本数量必须在 1–{DEBUG_LIMIT} 之间"])
        chosen = set()
        def include(node_id):
            if node_id in chosen:
                return
            chosen.add(node_id)
            for parent in nodes[node_id].get("inputs", {}).values():
                include(parent)
        for target in target_ids:
            include(target)
    ordered = [node_id for node_id in validation["order"] if node_id in chosen]
    selected_graph = (deepcopy(graph) if mode == "production" else
        {"nodes": [deepcopy(nodes[node_id]) for node_id in ordered]})
    semantics = semantic_graph(selected_graph)
    selected_snapshot = [manifests[f"{nodes[node_id]['operator']}@{nodes[node_id]['version']}"] for node_id in ordered]
    sources, blocked = [], []
    if mode == "debug":
        for node, manifest in zip(selected_graph["nodes"], selected_snapshot):
            if reason := debug_blocked_reason(manifest):
                blocked.append({"node_id": node["id"], "reason": reason})
                continue
            if manifest["kind"] == "source":
                records = node["config"]["records"][:limit]
                from .artifact_store import _file_references
                if any(_file_references({"records": records})):
                    blocked.append({"node_id": node["id"], "reason": "固定内联调试样本不能包含需要读取项目文件的 path 或 *_path 引用"})
                    continue
                node["config"]["records"] = deepcopy(records)
                identity = digest(records)
                sources.append({"node_id": node["id"], "record_ids": [record["id"] for record in records],
                    "record_count": len(records), "content_hash": identity, "identity": identity,
                    "source_kind": "inline-version"})
        if blocked:
            raise PlanError([f"{item['node_id']}: {item['reason']}" for item in blocked], blocked)
    plan = {"mode": mode, "version": version, "targets": target_ids, "node_ids": ordered,
        "graph": selected_graph, "semantic_digest": digest(semantics),
        "sample": {"limit": limit, "sources": sources, "fixed": mode == "debug",
            "source_kind": "inline-version" if mode == "debug" else None},
        "warnings": ["仅使用保存版本中的固定内联文档样本；调试产物不能发布为数据集版本。"] if mode == "debug" else [],
        "blocked": []}
    plan["plan_digest"] = digest({"mode": mode, "version": version, "targets": target_ids,
        "graph": semantic_graph(selected_graph), "semantic_digest": plan["semantic_digest"],
        "implementations": [{"key": item["key"], "digest": item["implementation_digest"]} for item in selected_snapshot],
        "sample": plan["sample"], "use_cache": use_cache, "environment_id": environment_id,
        "worker_pool_id": worker_pool_id, "execution_binding": execution_binding})
    return plan


def run_plan(db, run_id: str) -> dict | None:
    from sqlalchemy import select
    from .pipeline_models import PipelineRunSubmission
    submission = db.scalar(select(PipelineRunSubmission).where(PipelineRunSubmission.run_id == run_id))
    return (submission.request_options or {}).get("execution_plan") if submission else None


def run_mode(db, run_id: str) -> str:
    from sqlalchemy import select
    from .pipeline_models import PipelineRunSubmission
    submission = db.scalar(select(PipelineRunSubmission).where(PipelineRunSubmission.run_id == run_id))
    return (submission.request_options or {}).get("mode", "production") if submission else "production"
