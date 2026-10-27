"""Bounded dataset DAG compiler and local subprocess operator executor.

This runner is for trusted developer plugins. A separate process bounds duration
and separates dependencies/state; it is NOT a security sandbox or a distributed
execution engine. No DB/auth application modules are imported by the worker.
"""

from collections import deque
from importlib import metadata as package_metadata
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any, Collection

from .pipeline_sdk import ARTIFACT_TYPES, DocumentRecord, ID_PATTERN, OperatorConfig, OperatorDefinition, PluginDefinition

MAX_RECORDS = 1_000_000
MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
# The protocol contains both configuration and an input artifact. Its envelope
# must not make an otherwise valid maximum-sized artifact impossible to consume.
MAX_REQUEST_BYTES = MAX_PAYLOAD_BYTES * 2 + 65_536
MAX_NODES = 40
SDK_VERSION = "1"


def _validate_plugin(plugin: PluginDefinition, expected_id: str) -> PluginDefinition:
    if not isinstance(plugin, PluginDefinition) or plugin.id != expected_id:
        raise ValueError(f"plugin entry point must return PluginDefinition with id {expected_id}")
    if not ID_PATTERN.fullmatch(plugin.id) or plugin.sdk_version != SDK_VERSION:
        raise ValueError(f"unsupported plugin ID or SDK version: {expected_id}")
    seen = set()
    for operator in plugin.operators:
        if not isinstance(operator, OperatorDefinition) or not ID_PATTERN.fullmatch(operator.id):
            raise ValueError(f"invalid operator in {expected_id}")
        if operator.key in seen or not operator.version:
            raise ValueError(f"duplicate or unversioned operator: {operator.id}")
        if operator.kind not in {"source", "transform", "sink"}:
            raise ValueError(f"invalid operator role: {operator.id}")
        if (operator.kind == "source") != (operator.input_type is None and not operator.input_ports):
            raise ValueError(f"invalid input contract: {operator.id}")
        if operator.input_type not in {None, *ARTIFACT_TYPES} or operator.output_type not in ARTIFACT_TYPES:
            raise ValueError(f"invalid artifact type: {operator.id}")
        if any(not ID_PATTERN.fullmatch(port) or kind not in ARTIFACT_TYPES for port, kind in operator.input_ports.items()):
            raise ValueError(f"invalid input ports: {operator.id}")
        if operator.batch_handler is not None and (not callable(operator.batch_handler) or
                isinstance(operator.batch_size, bool) or not 1 <= operator.batch_size <= 5000):
            raise ValueError(f"invalid batch execution contract: {operator.id}")
        operator.config_model.model_validate(operator.default_config)
        seen.add(operator.key)
    return plugin


def _plugins() -> dict[str, PluginDefinition]:
    plugins = {}
    # Definitions import no heavy models; ML dependencies live in a separate worker.
    from .media_plugin import plugin as media_plugin
    plugins["media.video"] = _validate_plugin(media_plugin(), "media.video")
    from .connection_plugin import plugin as object_plugin
    plugins["object.storage"] = _validate_plugin(object_plugin(), "object.storage")
    from .documents_plugin import plugin as documents_plugin
    plugins["documents.core"] = _validate_plugin(documents_plugin(), "documents.core")
    allowlist = {value.strip() for value in os.environ.get("FLYWHEEL_PLUGIN_ALLOWLIST", "").split(",") if value.strip()}
    bundled_ids, installed_ids = set(plugins), set()
    for entry_point in package_metadata.entry_points(group="data_flywheel.operators"):
        if entry_point.name not in allowlist or entry_point.name in bundled_ids:
            continue
        if entry_point.name in installed_ids:
            raise ValueError(f"duplicate installed plugin entry point: {entry_point.name}")
        installed_ids.add(entry_point.name)
        definition = entry_point.load()
        plugin = definition() if callable(definition) else definition
        plugins[entry_point.name] = _validate_plugin(plugin, entry_point.name)
    # Operator IDs cannot be shadowed by another plugin, including different versions.
    owners = {}
    for plugin in plugins.values():
        for operator in plugin.operators:
            if operator.id in owners and owners[operator.id] != plugin.id:
                raise ValueError(f"operator ID collision: {operator.id}")
            owners[operator.id] = plugin.id
    return plugins


def list_plugins() -> list[dict[str, Any]]:
    return [plugin.manifest() for plugin in _plugins().values()]


def list_operators(plugin_ids: Collection[str] | None = None) -> list[dict[str, Any]]:
    enabled = set() if plugin_ids is None else set(plugin_ids)
    return [operator.manifest(plugin.id, plugin.version)
            for plugin in _plugins().values() if plugin.id in enabled
            for operator in plugin.operators]


def _get_operator(operator_id: str, version: str, manifest: dict | None = None) -> OperatorDefinition:
    if manifest and manifest.get("release_id"):
        if manifest["id"] != operator_id or manifest["version"] != version:
            raise ValueError("Plugin manifest identity mismatch")
        from .plugin_release_adapter import definition_from_manifest
        return definition_from_manifest(manifest)
    for plugin in _plugins().values():
        for operator in plugin.operators:
            if operator.id == operator_id and operator.version == version:
                return operator
    raise ValueError(f"operator is not installed: {operator_id}@{version}")


def validate_graph(graph: dict, allowed_operator_keys: Collection[str], operator_manifests: dict | None = None) -> dict[str, Any]:
    errors = []
    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
        return {"valid": False, "errors": ["graph.nodes must be a list"], "order": []}
    nodes = graph["nodes"]
    if not 1 <= len(nodes) <= MAX_NODES:
        return {"valid": False, "errors": [f"pipeline must contain 1–{MAX_NODES} nodes"], "order": []}
    try:
        if len(_json_bytes(graph, "pipeline")) > MAX_PAYLOAD_BYTES:
            return {"valid": False, "errors": ["pipeline configuration exceeds 8 MiB"], "order": []}
    except (TypeError, ValueError):
        return {"valid": False, "errors": ["pipeline must contain finite, UTF-8 encodable JSON values"], "order": []}
    definitions, by_id = {}, {}
    allowed = set(allowed_operator_keys)
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,79}", node["id"]):
            errors.append("each node requires a valid ID (letter followed by letters, digits, _ or -)")
            continue
        node_id = node["id"]
        if "position" in node:
            position = node["position"]
            if (not isinstance(position, dict) or set(position) != {"x", "y"}
                    or any(not _finite_vector_value(position.get(axis)) or abs(position[axis]) > 1_000_000
                           for axis in ("x", "y"))):
                errors.append(f"{node_id}: canvas position requires finite x/y coordinates")
        if node_id in by_id:
            errors.append(f"duplicate node ID: {node_id}")
            continue
        by_id[node_id] = node
        key = f"{node.get('operator')}@{node.get('version')}"
        if key not in allowed:
            errors.append(f"{node_id}: operator is not enabled: {key}")
            continue
        try:
            definition = _get_operator(node.get("operator"), node.get("version"), (operator_manifests or {}).get(key))
            definitions[node_id] = definition
            definition.config_model.model_validate(node.get("config", {}))
        except (ValueError, TypeError) as error:
            errors.append(f"{node_id}: {error}")
    dependencies = {node_id: set() for node_id in by_id}
    children = {node_id: [] for node_id in by_id}
    for node_id, node in by_id.items():
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            errors.append(f"{node_id}: inputs must be an object")
            continue
        definition = definitions.get(node_id)
        if definition:
            expected = set() if definition.kind == "source" else set(definition.input_ports) if definition.input_ports else {"data"}
            if set(inputs) != expected:
                errors.append(f"{node_id}: expected input ports {sorted(expected)}")
        for port, upstream in inputs.items():
            if not isinstance(upstream, str) or upstream not in by_id:
                errors.append(f"{node_id}: input refers to a missing node: {upstream}")
                continue
            dependencies[node_id].add(upstream)
            if node_id not in children[upstream]:
                children[upstream].append(node_id)
            source = definitions.get(upstream)
            if source and source.kind == "sink":
                errors.append(f"{node_id}: sink node {upstream} cannot have downstream nodes")
            expected_type = definition.input_ports.get(port) if definition and definition.input_ports else definition.input_type if definition else None
            if definition and source and source.output_type != expected_type:
                errors.append(f"{node_id}: input type mismatch ({source.output_type} → {expected_type})")
    pending = {node_id: len(deps) for node_id, deps in dependencies.items()}
    queue = deque(node_id for node_id, count in pending.items() if count == 0)
    order = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for child in children[current]:
            pending[child] -= 1
            if pending[child] == 0:
                queue.append(child)
    if len(order) != len(by_id):
        errors.append("pipeline contains a cycle")
    return {"valid": not errors, "errors": errors, "order": order if not errors else []}


def validate_artifact(payload: Any, expected_type: str) -> dict:
    if not isinstance(payload, dict) or payload.get("type") != expected_type:
        raise ValueError(f"expected {expected_type} artifact")
    if not isinstance(payload.get("records"), list) or len(payload["records"]) > MAX_RECORDS:
        raise ValueError(f"artifact records must be a list with at most {MAX_RECORDS} records")
    metadata = payload.get("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("artifact metadata must be an object")
    dimensions = None
    if expected_type in {"embeddings", "index"}:
        embedding = metadata.get("embedding")
        if not isinstance(embedding, dict) or any(
            not isinstance(embedding.get(field), str)
            or not embedding[field].strip()
            or embedding[field] != embedding[field].strip()
            for field in ("model", "version")
        ):
            raise ValueError("embedding metadata requires non-blank model and version strings without surrounding whitespace")
        dimensions = embedding.get("dimensions")
        if not isinstance(dimensions, int) or isinstance(dimensions, bool) or not 1 <= dimensions <= 4096:
            raise ValueError("embedding metadata requires dimensions between 1 and 4096")
        if any(field in embedding and not isinstance(embedding[field], bool) for field in ("normalized", "semantic")):
            raise ValueError("embedding normalized and semantic flags must be booleans")
    ids, records = set(), []
    for record in payload["records"]:
        if not isinstance(record, dict):
            raise ValueError("artifact record must be an object")
        parsed_record = DocumentRecord.model_validate({key: value for key, value in record.items() if key != "vector"})
        if record["id"] in ids:
            raise ValueError(f"duplicate record ID: {record['id']}")
        ids.add(record["id"])
        if dimensions is not None:
            vector = record.get("vector")
            if not isinstance(vector, list) or len(vector) != dimensions or not all(_finite_vector_value(value) for value in vector):
                raise ValueError("vector does not match embedding dimensions or contains non-finite values")
        elif "vector" in record:
            raise ValueError("document records cannot contain vectors")
        records.append({**parsed_record.model_dump(), **({"vector": record["vector"]} if dimensions is not None else {})})
    normalized = {**payload, "records": records, "metadata": metadata}
    _json_bytes(normalized, "artifact")  # Validate finite JSON; persistence shards large results.
    return normalized


def _json_bytes(value: Any, label: str) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"{label} must contain finite, UTF-8 encodable JSON values") from error


def _finite_vector_value(value: Any) -> bool:
    try:
        return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        return False


def _execute_in_worker(operator: str, version: str, config: dict, input_payload: dict | None) -> dict:
    definition = _get_operator(operator, version)
    if len(_json_bytes(config, "operator configuration")) > MAX_PAYLOAD_BYTES:
        raise ValueError("operator configuration exceeds the 8 MiB local execution limit")
    parsed_config = definition.config_model.model_validate(config)
    if definition.input_ports:
        if not isinstance(input_payload, dict) or set(input_payload) != set(definition.input_ports):
            raise ValueError("Named input artifacts do not match the operator ports")
        input_payload = {port: validate_artifact(input_payload[port], kind) for port, kind in definition.input_ports.items()}
    elif definition.input_type is None:
        if input_payload is not None:
            raise ValueError("source operator must not receive an input artifact")
    else:
        input_payload = validate_artifact(input_payload, definition.input_type)
    result = definition.handler(parsed_config, input_payload)
    return validate_artifact(result, definition.output_type)


def execute_operator(operator: str, version: str, config: dict, input_payload: dict | None, timeout_seconds: float = 30) -> dict:
    """Execute installed trusted code in a worker with no inherited app secrets.

    Project enablement and immutable version checks are the caller's responsibility.
    The local worker receives JSON only and returns a validated artifact payload.
    """
    definition = _get_operator(operator, version)
    definition.config_model.model_validate(config)
    if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)) or not 0 < timeout_seconds <= 300:
        raise ValueError("timeout_seconds must be greater than 0 and at most 300")
    if len(_json_bytes(config, "operator configuration")) > MAX_PAYLOAD_BYTES:
        raise ValueError("operator configuration exceeds the 8 MiB local execution limit")
    if definition.input_ports:
        if not isinstance(input_payload, dict) or set(input_payload) != set(definition.input_ports):
            raise ValueError("Named input artifacts do not match the operator ports")
        input_payload = {port: validate_artifact(input_payload[port], kind) for port, kind in definition.input_ports.items()}
    elif definition.input_type is None:
        if input_payload is not None:
            raise ValueError("source operator must not receive an input artifact")
    else:
        input_payload = validate_artifact(input_payload, definition.input_type)
    request = _json_bytes({"operator": operator, "version": version, "config": config, "input_payload": input_payload}, "operator request")
    if len(request) > MAX_REQUEST_BYTES:
        raise ValueError("operator request exceeds the local protocol limit")
    api_root = str(Path(__file__).resolve().parents[1])
    environment = {
        "PATH": os.defpath, "PYTHONPATH": api_root, "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1",
        "FLYWHEEL_PLUGIN_ALLOWLIST": os.environ.get("FLYWHEEL_PLUGIN_ALLOWLIST", ""),
    }
    with tempfile.TemporaryDirectory(prefix="flywheel-worker-") as workdir, tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        try:
            process = subprocess.run([sys.executable, "-m", "app.pipeline_worker"], input=request,
                                     stdout=output, stderr=errors, cwd=workdir, env=environment,
                                     timeout=timeout_seconds, check=False)
        except subprocess.TimeoutExpired as error:
            raise TimeoutError(f"operator timed out after {timeout_seconds:g} seconds") from error
        if output.tell() > MAX_PAYLOAD_BYTES + 65_536:
            raise ValueError("worker output exceeds the local execution limit")
        output.seek(0)
        try:
            result = json.load(output)
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError("operator worker failed without a valid response") from error
        if process.returncode or not result.get("ok"):
            raise ValueError(str(result.get("error", "operator worker failed"))[:4000])
        return validate_artifact(result.get("artifact"), definition.output_type)
