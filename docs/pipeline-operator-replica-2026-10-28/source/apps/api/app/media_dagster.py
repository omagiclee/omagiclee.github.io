"""Compile immutable platform graphs to real Dagster ops and jobs.

Dagster owns scheduling, subprocess execution, retries, events and cancellation.
Op values are artifact IDs; media bytes and large manifests never travel through
the orchestration IO manager. SQL stores the platform-facing projection.
"""

from copy import deepcopy
import hashlib
import json
import logging
from time import monotonic
from typing import Any

from dagster import (AssetKey, AssetMaterialization, DagsterRunStatus, DefaultSensorStatus,
                     Definitions, DependencyDefinition, Failure, GraphDefinition, In, Out,
                     RetryPolicy, SkipReason, in_process_executor, op, run_status_sensor, sensor)
from sqlalchemy import select, update

from . import database, media_jobs, pipeline_runtime
from .media_models import DagsterExecution
from .media_store import MediaCancelled, check_cancelled, media_context, processing_signature
from .pipeline_models import Pipeline, PipelineArtifact, PipelineRun, PipelineTaskRun, PipelineVersion
from .task_leases import claim_task, finish_task, task_heartbeat


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def op_name(node_id: str, job_identity: str = "") -> str:
    # Dagster op names are repository-global, including across job versions.
    # Namespace the closure/config by immutable job identity as well as node ID.
    safe = "".join(character if character.isalnum() or character == "_" else "_" for character in node_id)
    digest = hashlib.sha256(f"{job_identity}\x00{node_id}".encode()).hexdigest()[:16]
    return f"node_{safe}_{digest}"


def _execute_node(context, node: dict, manifest: dict, input_artifact_id: str | dict[str, str] | None) -> str:
    run_id = context.run.tags.get("flywheel/run_id", context.run_id)
    with database.SessionLocal() as db:
        run = db.get(PipelineRun, run_id)
        if run is None or run.status not in {"pending", "running"}:
            raise Failure("Platform run is absent or stopped", allow_retries=False)
        if context.run.tags.get("flywheel/project_id", run.project_id) != run.project_id:
            raise Failure("Framework project tag does not match persisted run", allow_retries=False)
        from .pipeline_plans import DEBUG_LIMIT, debug_blocked_reason, run_mode, run_plan
        mode = run_mode(db, run.id)
        if mode == "debug":
            plan = run_plan(db, run.id)
            if (not plan or plan.get("mode") != "debug" or plan.get("graph") != run.graph
                    or node["id"] not in plan.get("node_ids", []) or debug_blocked_reason(manifest)):
                raise Failure("Debug execution does not match its bounded immutable plan", allow_retries=False)
        persisted_node = next((item for item in run.graph["nodes"] if item["id"] == node["id"]), None)
        persisted_manifest = next((item for item in run.operator_snapshot if item["key"] == manifest["key"]), None)
        contract = lambda value: {key: item for key, item in (value or {}).items() if key != "config"}
        if contract(persisted_node) != contract(node) or not persisted_manifest or persisted_manifest["implementation_digest"] != manifest["implementation_digest"]:
            raise Failure("Compiled job does not match the immutable platform run", allow_retries=False)
        # A deployment may freeze validated input/config overrides while the
        # saved version retains the same operator and dependency topology.
        node = deepcopy(persisted_node)
        if run.status == "pending":
            db.execute(update(PipelineRun).where(PipelineRun.id == run.id, PipelineRun.status == "pending").values(status="running"))
            db.commit()
        task = db.scalar(select(PipelineTaskRun).where(PipelineTaskRun.run_id == run.id,
                                                       PipelineTaskRun.node_id == node["id"]))
        if task is None:
            raise Failure("Platform task is absent", allow_retries=False)
        input_ids = ({"data": input_artifact_id} if isinstance(input_artifact_id, str) else input_artifact_id) or {}
        parents = {port: db.get(PipelineArtifact, artifact_id) for port, artifact_id in sorted(input_ids.items())}
        if any(parent is None or parent.project_id != run.project_id or parent.run_id != run.id for parent in parents.values()):
            raise Failure("Input artifact is absent or not part of this project/run", allow_retries=False)
        parent_ids = [parent.id for parent in parents.values()]
        from .artifact_store import persist_payload, verify_payload, validate_payload_files, verify_stream
        streaming = manifest.get("execution_protocol") == "batch-v1"
        try:
            if streaming:
                for parent in parents.values():
                    verify_stream(parent.payload, run.project_id, parent.content_hash)
                parent_payloads = {port: parent.payload for port, parent in parents.items()}
            else:
                parent_payloads = {port: verify_payload(parent.payload, run.project_id, parent.content_hash)
                    for port, parent in parents.items()}
        except (ValueError, OSError, KeyError, TypeError) as error:
            raise Failure("Input artifact integrity failed: " + str(error), allow_retries=False) from error
        if task.status in {"succeeded", "cached"} and task.artifact_id:
            completed = db.get(PipelineArtifact, task.artifact_id)
            if (completed and completed.project_id == run.project_id and completed.run_id == run.id
                    and completed.node_id == node["id"] and completed.type == manifest["output_type"]
                    and completed.parent_artifact_ids == parent_ids):
                try:
                    verify_stream(completed.payload, run.project_id, completed.content_hash)
                except (ValueError, OSError, KeyError, TypeError) as error:
                    raise Failure("Committed node artifact integrity failed: " + str(error), allow_retries=False) from error
                # SQL output commit may precede the framework STEP_SUCCESS event.
                # Recover this output even for a side-effecting operator.
                return completed.id
            raise Failure("Committed node artifact is missing or corrupt; explicit repair required", allow_retries=False)
        retry_safe = manifest.get("retry_safe")
        if retry_safe is None:
            retry_safe = manifest["deterministic"] and not manifest["side_effects"]
        execution_key = _hash({"run": run.id, "node": node, "operator": manifest["implementation_digest"],
            "inputs": input_ids})
        try:
            lease_token = claim_task(db, task, execution_key, retry_safe)
        except RuntimeError as error:
            raise Failure(str(error), allow_retries=False) from error
        started = monotonic()
        task.status, task.error = "running", None
        task.input_count = sum(parent.record_count for parent in parents.values())
        db.commit()
        with media_context(run.project_id, run.id), task_heartbeat(task.id, lease_token):
            try:
                check_cancelled()
                generation = processing_signature()
                if manifest.get("release_id"):
                    from .plugin_release_service import resolve_release
                    release = resolve_release(manifest["release_id"], run.project_id)
                    live = next(item for item in release["operator_manifests"] if item["key"] == manifest["key"])
                else:
                    live = next(item for item in pipeline_runtime.list_operators([manifest["plugin_id"]])
                                if item["key"] == manifest["key"])
                if live["implementation_digest"] != manifest["implementation_digest"]:
                    raise Failure("算子实现已变化，请保存新的 Pipeline 版本后运行", allow_retries=False)
                cache_key = _hash({"contract": "dagster-v1", "operator": manifest["key"],
                    "implementation_digest": manifest["implementation_digest"], "config": node.get("config", {}),
                    "input_hashes": {port: parent.content_hash for port, parent in parents.items()}, "processing_signature": generation})
                if mode == "debug":
                    # A sampled result must never satisfy a production cache
                    # lookup, including when the full input has <= sample_limit.
                    cache_key = _hash({"base": cache_key, "execution_mode": "debug"})
                cached = None
                cached_payload = None
                cacheable = manifest.get("cacheable")
                if cacheable is None:
                    cacheable = manifest["deterministic"] and not manifest["side_effects"]
                if context.run.tags.get("flywheel/use_cache", "true") == "true" and cacheable:
                    for candidate in db.scalars(select(PipelineArtifact).where(
                        PipelineArtifact.project_id == run.project_id, PipelineArtifact.cache_key == cache_key,
                    ).order_by(PipelineArtifact.created_at.desc()).limit(20)):
                        try:
                            if streaming:
                                verify_stream(candidate.payload, run.project_id, candidate.content_hash)
                                candidate_payload = candidate.payload
                            else:
                                candidate_payload = verify_payload(candidate.payload, run.project_id, candidate.content_hash)
                                if not validate_payload_files(candidate.payload, run.project_id):
                                    continue
                        except (ValueError, OSError, KeyError, TypeError):
                            continue
                        else:
                            cached = candidate
                            cached_payload = candidate_payload
                            break
                # This code executes inside Dagster's launched run process.
                # Trusted plugins keep the run context; model adapters manage
                # their separate CPU/MPS/CUDA inference runtimes.
                inputs = parent_payloads
                input_payload = (inputs["data"] if set(inputs) == {"data"} and not manifest.get("input_ports") else inputs or None)
                if streaming:
                    if manifest.get("release_id"):
                        raise Failure("Isolated wheel batch execution is not supported; use its dataset protocol", allow_retries=False)
                    if cached:
                        stored_output, output_hash = cached_payload, cached.content_hash
                    else:
                        from .streaming_runtime import execute_batches
                        definition = pipeline_runtime._get_operator(node["operator"], node["version"])
                        # Hold the registered shared reference guard across
                        # object writes and independent partition SQL commits.
                        db.execute(select(PipelineRun.id).where(PipelineRun.id == run.id))
                        from .dispatch_models import PipelineDispatch
                        intent=db.get(PipelineDispatch,run.id)
                        environment_id=(intent.execution_snapshot or {}).get("environment_id") if intent else None
                        stored_output, output_hash = execute_batches(definition, node.get("config", {}), parent_payloads,
                            run.project_id, task.id, run.id, lease_token, execution_key, environment_id)
                    output_count = stored_output["manifest"]["record_count"]
                elif cached:
                    output = cached_payload
                elif manifest.get("release_id"):
                    from .plugin_release_adapter import execute_manifest
                    output = execute_manifest(manifest, node.get("config", {}), input_payload, run.project_id)
                else:
                    output = pipeline_runtime._execute_in_worker(node["operator"], node["version"], node.get("config", {}),
                                                                 input_payload)
                check_cancelled()
                if not streaming:
                    output = pipeline_runtime.validate_artifact(output, manifest["output_type"])
                    if mode == "debug":
                        if len(output["records"]) > DEBUG_LIMIT:
                            raise Failure(f"Debug node output exceeds {DEBUG_LIMIT} records", allow_retries=False)
                        from .artifact_store import _file_references
                        if any(_file_references(output)):
                            raise Failure("Debug document outputs cannot access project file references", allow_retries=False)
                        output = {**output, "metadata": {**output.get("metadata", {}), "execution_mode": "debug"}}
                    stored_output, output_hash = persist_payload(output, run.project_id), _hash(output)
                    output_count = len(output["records"])
                active = db.execute(update(PipelineRun).where(PipelineRun.id == run.id,
                    PipelineRun.status.in_(["pending", "running"])).values(status="running"))
                if active.rowcount != 1:
                    raise MediaCancelled("Platform run stopped before output commit")
                artifact = PipelineArtifact(project_id=run.project_id, run_id=run.id, node_id=task.node_id,
                    type=stored_output["type"], record_count=output_count, content_hash=output_hash,
                    cache_key=cache_key, payload=stored_output, parent_artifact_ids=parent_ids,
                    cache_origin_id=cached.id if cached else None)
                db.add(artifact)
                db.flush()
                if not finish_task(db, task.id, lease_token, artifact_id=artifact.id):
                    db.rollback()
                    raise Failure("Node execution lease was superseded; stale output discarded", allow_retries=False)
                task.artifact_id, task.output_count = artifact.id, artifact.record_count
                task.status = "cached" if cached else "succeeded"
                task.duration_ms = max(0, round((monotonic() - started) * 1000))
                db.commit()
                try:
                    context.log_event(AssetMaterialization(
                        asset_key=AssetKey(["project", run.project_id, "pipeline", run.pipeline_id, task.node_id]),
                        metadata={"artifact_id": artifact.id, "records": artifact.record_count,
                                  "content_hash": artifact.content_hash, "operator": manifest["key"],
                                  "processing_signature": generation}))
                except Exception:
                    logging.getLogger(__name__).exception("Artifact committed; framework event will be recovered on retry")
                return artifact.id
            except Exception as error:
                db.rollback()
                db.refresh(task)
                if not finish_task(db, task.id, lease_token, error=str(error)[:2000]):
                    db.rollback()
                    raise
                task.status = "cancelled" if isinstance(error, MediaCancelled) else "failed"
                task.error = str(error)[:2000] or type(error).__name__
                task.duration_ms = max(0, round((monotonic() - started) * 1000))
                run.error = f"{task.node_id}: {task.error}"
                db.commit()
                raise


def _make_op(node: dict, manifest: dict, job_identity: str):
    inputs = node.get("inputs", {})
    safe = manifest.get("retry_safe")
    if safe is None:
        safe = manifest["deterministic"] and not manifest["side_effects"]
    retry = RetryPolicy(max_retries=2, delay=1) if safe else None

    @op(name=op_name(node["id"], job_identity), ins={port: In(str) for port in inputs}, out=Out(str),
        retry_policy=retry, description=manifest["description"], tags={"flywheel/operator": manifest["key"]})
    def execute(context, **kwargs):
        return _execute_node(context, node, manifest, kwargs)

    return execute


def compile_job(graph: dict, snapshot: list[dict], name: str):
    manifests = {item["key"]: item for item in snapshot}
    validation = pipeline_runtime.validate_graph(graph, set(manifests), manifests)
    if not validation["valid"]:
        raise ValueError("; ".join(validation["errors"]))
    nodes = {node["id"]: deepcopy(node) for node in graph["nodes"]}
    definitions, dependencies = [], {}
    for node_id in validation["order"]:
        node = nodes[node_id]
        manifest = manifests[f"{node['operator']}@{node['version']}"]
        definitions.append(_make_op(node, manifest, name))
        if inputs := node.get("inputs", {}):
            dependencies[op_name(node_id, name)] = {port: DependencyDefinition(op_name(upstream, name))
                                                   for port, upstream in inputs.items()}
    # The run launcher creates an isolated run process. Local media workloads
    # execute ops serially in that process to respect this Mac's memory budget.
    # Dagster still schedules dependencies, retries and persists all events.
    return GraphDefinition(name=name, node_defs=definitions, dependencies=dependencies).to_job(
        executor_def=in_process_executor, tags={"flywheel/compiled": "true"})


def _project_framework_event(context) -> None:
    run_id = context.dagster_run.tags.get("flywheel/run_id")
    if not run_id:
        return
    with database.SessionLocal() as db:
        run = db.get(PipelineRun, run_id)
        if run and db.get(DagsterExecution, run_id):
            media_jobs.apply_framework_status(db, run, context.dagster_run.status.value)


@run_status_sensor(run_status=DagsterRunStatus.SUCCESS, monitor_all_code_locations=True,
                   default_status=DefaultSensorStatus.RUNNING)
def publish_successful_media(context):
    _project_framework_event(context)


@run_status_sensor(run_status=DagsterRunStatus.FAILURE, monitor_all_code_locations=True,
                   default_status=DefaultSensorStatus.RUNNING)
def project_failed_media(context):
    _project_framework_event(context)


@run_status_sensor(run_status=DagsterRunStatus.CANCELED, monitor_all_code_locations=True,
                   default_status=DefaultSensorStatus.RUNNING)
def project_cancelled_media(context):
    _project_framework_event(context)


@sensor(minimum_interval_seconds=30, default_status=DefaultSensorStatus.RUNNING)
def reconcile_cancelled_submissions(context):
    offset = int(context.cursor or "0")
    count = media_jobs.reconcile_cancelled_runs(limit=5, offset=offset)
    context.update_cursor(str(offset + count if count == 5 else 0))
    return SkipReason(f"Checked {count} cancelled platform runs for delayed framework submissions")


def definitions() -> Definitions:
    jobs = []
    with database.SessionLocal() as db:
        versions = list(db.scalars(select(PipelineVersion).join(Pipeline, Pipeline.id == PipelineVersion.pipeline_id)))
        for version in versions:
            try:
                jobs.append(compile_job(version.graph, version.operator_snapshot,
                                        media_jobs.job_name(version.pipeline_id, version.version)))
            except (ValueError, KeyError) as error:
                # Removed plugin versions are historical catalog entries, not
                # runnable jobs. They must not prevent healthy versions loading.
                logging.getLogger(__name__).warning("Skipping unavailable pipeline version %s v%s: %s",
                                                     version.pipeline_id, version.version, str(error)[:300])
        from .pipeline_models import PipelineRunSubmission
        active_runs = db.execute(select(PipelineRun, PipelineRunSubmission.request_options).join(
            PipelineRunSubmission, PipelineRunSubmission.run_id == PipelineRun.id).where(
            PipelineRun.status.in_(["pending", "running"]))).all()
        for run, options in active_runs:
            if (options or {}).get("mode") != "debug":
                continue
            plan = (options or {}).get("execution_plan")
            if not plan or plan.get("graph") != run.graph:
                logging.getLogger(__name__).warning("Skipping inconsistent debug run %s", run.id)
                continue
            try:
                jobs.append(compile_job(run.graph, run.operator_snapshot, media_jobs.debug_job_name(run.id)))
            except (ValueError, KeyError) as error:
                logging.getLogger(__name__).warning("Skipping unavailable debug run %s: %s", run.id, str(error)[:300])
    return Definitions(jobs=jobs, sensors=[publish_successful_media, project_failed_media, project_cancelled_media,
                                         reconcile_cancelled_submissions])
