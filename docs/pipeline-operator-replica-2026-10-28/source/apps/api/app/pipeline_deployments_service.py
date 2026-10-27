"""Deployment snapshots, interval scheduling, and deduplicated data events."""
from copy import deepcopy
from datetime import timedelta, timezone
import hashlib
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update

from . import database, pipeline_runtime
from .dispatch_worker import enqueue_run
from .execution_resources import freeze_execution
from .media_models import DagsterExecution
from .media_jobs import job_name
from .models import AppUser, AuditEvent, utc_now
from .rbac import Scope, is_allowed
from .pipeline_models import Pipeline, PipelineRun, PipelineTaskRun, PipelineVersion
from .pipeline_deployments_models import PipelineDeployment, PipelineDeploymentTrigger


def create_deployment(db, project_id: str, created_by: str, payload) -> PipelineDeployment:
    pipeline = db.get(Pipeline, payload.pipeline_id)
    if not pipeline or pipeline.project_id != project_id:
        raise ValueError("Pipeline is absent or outside this project")
    version = db.scalar(select(PipelineVersion).where(PipelineVersion.pipeline_id == pipeline.id,
        PipelineVersion.version == payload.pipeline_version))
    if not version:
        raise ValueError("Saved pipeline version does not exist")
    ZoneInfo(payload.timezone)
    graph = deepcopy(version.graph)
    known = {node["id"] for node in graph["nodes"]}
    if set(payload.input_configs) - known:
        raise ValueError("Input configuration refers to an unknown node")
    for node in graph["nodes"]:
        if node["id"] in payload.input_configs:
            node["config"] = {**node.get("config", {}), **payload.input_configs[node["id"]]}
    manifests = {item["key"]: item for item in version.operator_snapshot}
    validation = pipeline_runtime.validate_graph(graph, set(manifests), manifests)
    if not validation["valid"]:
        raise ValueError("; ".join(validation["errors"]))
    revision = (db.scalar(select(func.max(PipelineDeployment.revision)).where(
        PipelineDeployment.project_id == project_id, PipelineDeployment.name == payload.name)) or 0) + 1
    snapshot = freeze_execution(db, project_id, payload.environment_id, payload.worker_pool_id)
    next_at = payload.first_trigger_at if payload.trigger_kind == "interval" else None
    if next_at is None and payload.trigger_kind == "interval":
        next_at = utc_now() + timedelta(seconds=payload.interval_seconds)
    row = PipelineDeployment(project_id=project_id, pipeline_id=pipeline.id, pipeline_version=version.version,
        name=payload.name, revision=revision, graph=graph, operator_snapshot=deepcopy(version.operator_snapshot),
        execution_snapshot=snapshot, trigger_kind=payload.trigger_kind, interval_seconds=payload.interval_seconds,
        timezone=payload.timezone, next_trigger_at=next_at, use_cache=payload.use_cache,
        webhook_secret_ref=payload.webhook_secret_ref, created_by=created_by)
    # Activate one revision per named deployment; historical runs keep their
    # original snapshot and revision references.
    db.execute(update(PipelineDeployment).where(PipelineDeployment.project_id == project_id,
        PipelineDeployment.name == payload.name).values(paused=True))
    db.add(row)
    db.flush()
    return row


def trigger_deployment(db, deployment: PipelineDeployment, event_key: str, source: str,
                       actor_user_id: str | None = None, partition: str | None = None) -> PipelineDeploymentTrigger:
    existing = db.scalar(select(PipelineDeploymentTrigger).where(
        PipelineDeploymentTrigger.deployment_id == deployment.id, PipelineDeploymentTrigger.event_key == event_key))
    if existing:
        return existing
    # Serialize with pause and concurrent triggers; active runs are unaffected.
    active = db.execute(update(PipelineDeployment).where(PipelineDeployment.id == deployment.id,
        PipelineDeployment.paused.is_(False)).values(last_error=None))
    if active.rowcount != 1:
        raise ValueError("Deployment is paused; resume it before creating new runs")
    # After acquiring the deployment lock, an identical event may have won.
    existing = db.scalar(select(PipelineDeploymentTrigger).where(
        PipelineDeploymentTrigger.deployment_id == deployment.id, PipelineDeploymentTrigger.event_key == event_key))
    if existing:
        return existing
    actor = actor_user_id or deployment.created_by
    user = db.get(AppUser, actor)
    if not user or not user.is_active or not is_allowed(db, actor, Scope("project", deployment.project_id), "pipelines", "run"):
        raise ValueError("Deployment owner no longer has permission to execute this project's pipelines")
    graph = deepcopy(deployment.graph)
    def bind_partition(value):
        if isinstance(value, str):
            return value.replace("{{partition}}", partition) if partition is not None else value
        if isinstance(value, dict):
            return {key: bind_partition(item) for key, item in value.items()}
        if isinstance(value, list):
            return [bind_partition(item) for item in value]
        return value
    if partition is not None:
        for node in graph["nodes"]:
            node["config"] = bind_partition(node.get("config", {}))
        manifests = {item["key"]: item for item in deployment.operator_snapshot}
        validation = pipeline_runtime.validate_graph(graph, set(manifests), manifests)
        if not validation["valid"]:
            raise ValueError("Partition input configuration is invalid: " + "; ".join(validation["errors"]))
    run = PipelineRun(project_id=deployment.project_id, pipeline_id=deployment.pipeline_id,
        pipeline_name=deployment.name, pipeline_version=deployment.pipeline_version, graph=graph,
        operator_snapshot=deepcopy(deployment.operator_snapshot), status="pending",
        actor_user_id=actor, effective_user_id=actor)
    db.add(run)
    db.flush()
    for position, node in enumerate(run.graph["nodes"]):
        db.add(PipelineTaskRun(run_id=run.id, node_id=node["id"], operator=node["operator"], position=position))
    db.add(DagsterExecution(run_id=run.id, job_name=job_name(run.pipeline_id, run.pipeline_version)))
    snapshot = {**deployment.execution_snapshot, "deployment_id": deployment.id,
        "deployment_revision": deployment.revision, "trigger_source": source, "partition": partition}
    enqueue_run(db, run, deployment.use_cache, snapshot)
    trigger = PipelineDeploymentTrigger(deployment_id=deployment.id, event_key=event_key,
        source=source, partition=partition, run_id=run.id)
    db.add(trigger)
    db.add(AuditEvent(actor_user_id=actor, effective_user_id=actor, action="pipelines.deployment_triggered",
        scope_type="project", scope_id=deployment.project_id,
        details={"deployment_id": deployment.id, "run_id": run.id, "source": source, "partition": partition}))
    db.flush()
    return trigger


def run_schedules_once(now=None, limit: int = 50) -> int:
    now, count = now or utc_now(), 0
    with database.SessionLocal() as db:
        ids = list(db.scalars(select(PipelineDeployment.id).where(PipelineDeployment.trigger_kind == "interval",
            PipelineDeployment.paused.is_(False), PipelineDeployment.next_trigger_at <= now)
            .order_by(PipelineDeployment.next_trigger_at).limit(limit)))
    for deployment_id in ids:
        with database.SessionLocal() as db:
            deployment = db.get(PipelineDeployment, deployment_id)
            due = deployment.next_trigger_at
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            interval = deployment.interval_seconds
            # A stopped scheduler coalesces missed ticks into one occurrence.
            # Explicit backfill provides per-partition runs when required.
            next_at = due + timedelta(seconds=(max(0, int((now - due).total_seconds())) // interval + 1) * interval)
            changed = db.execute(update(PipelineDeployment).where(PipelineDeployment.id == deployment.id,
                PipelineDeployment.paused.is_(False), PipelineDeployment.next_trigger_at == deployment.next_trigger_at,
                PipelineDeployment.next_trigger_at <= now).values(next_trigger_at=next_at).execution_options(synchronize_session=False))
            if changed.rowcount != 1:
                db.rollback()
                continue
            try:
                trigger_deployment(db, deployment, "interval:" + due.isoformat(), "interval")
                db.commit()
                count += 1
            except Exception as error:
                db.rollback()
                # Preserve due time and allow retry; expose the failure to users.
                db.execute(update(PipelineDeployment).where(PipelineDeployment.id == deployment_id).values(last_error=str(error)[:2000]))
                db.commit()
    return count


def data_event_key(external_key: str) -> str:
    return "data:" + hashlib.sha256(external_key.encode()).hexdigest()
