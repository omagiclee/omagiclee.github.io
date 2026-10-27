"""Project-scoped immutable pipeline catalog with Dagster execution dispatch."""

from copy import deepcopy
import hashlib
import json
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import AuthContext, get_auth_context, record_audit, require_permission, verify_csrf
from .config import settings
from .database import get_db
from .models import Project, utc_now
from .pipeline_models import (
    OperatorPluginRegistration, Pipeline, PipelineArtifact, PipelineRun,
    PipelineTaskRun, PipelineVersion,
)
from .pipeline_runtime import execute_operator, list_operators, list_plugins, validate_graph
from .rbac import Scope


class PipelineRoute(APIRoute):
    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await original_handler(request)
            except RequestValidationError as exc:
                # Never echo document contents in field errors. Non-finite JSON
                # inputs (accepted by Python's parser) also cannot be re-encoded
                # safely by FastAPI's default error handler.
                return JSONResponse(status_code=422, content={"detail": [
                    {"loc": list(error["loc"]), "type": error["type"], "msg": error["msg"]}
                    for error in exc.errors()
                ]})

        return handle


router = APIRouter(prefix="/api", tags=["pipelines"], route_class=PipelineRoute)


class GraphRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    graph: dict[str, Any]

    @field_validator("graph")
    @classmethod
    def bounded_graph(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > 2_000_000:
            raise ValueError("Pipeline 定义不能超过 2 MB")
        return value


class PipelineCreate(GraphRequest):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)

    @field_validator("name")
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Pipeline 名称不能为空")
        return value


class VersionCreate(PipelineCreate):
    expected_version: int = Field(ge=1)


class PluginRegister(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plugin_id: str = Field(min_length=1, max_length=160)


class RunPlanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int | None = Field(default=None, ge=1)
    use_cache: bool = True
    environment_id: str | None = None
    worker_pool_id: str | None = None
    mode: Literal["production", "debug"] = "production"
    targets: list[str] | None = Field(default=None, min_length=1, max_length=40)
    sample_limit: int | None = Field(default=None, ge=1, le=100, strict=True)
    plan_digest: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class RunCreate(RunPlanCreate):
    idempotency_key: UUID | None = None


def _access(db: Session, context: AuthContext, project_id: str, action: str = "read",
            resource: str = "pipelines", request: Request | None = None) -> Scope:
    scope = Scope("project", project_id)
    require_permission(db, context, scope, resource, action)
    if db.get(Project, project_id) is None:
        raise HTTPException(404, "Project not found")
    if request is not None:
        verify_csrf(request, context)
    return scope


def _registered_plugins(db: Session, project_id: str) -> list[dict[str, Any]]:
    registered = {
        (row.plugin_id, row.version) for row in db.scalars(
            select(OperatorPluginRegistration).where(OperatorPluginRegistration.project_id == project_id)
        )
    }
    return [{**plugin, "operators": [op for op in list_operators([plugin["id"]])
                                    if op["plugin_id"] == plugin["id"]],
             "registered": (plugin["id"], plugin["version"]) in registered} for plugin in list_plugins()]


def _operators(db: Session, project_id: str) -> list[dict[str, Any]]:
    from .plugin_release_service import published_operators
    return list_operators([plugin["id"] for plugin in _registered_plugins(db, project_id) if plugin["registered"]]) + published_operators(project_id, db=db)


def _validation(db: Session, project_id: str, graph: dict[str, Any]) -> dict[str, Any]:
    manifests = {op["key"]: op for op in _operators(db, project_id)}
    return validate_graph(graph, set(manifests), manifests)


def _operator_snapshot(db: Session, project_id: str, graph: dict[str, Any]) -> list[dict[str, Any]]:
    operators = {f"{op['id']}@{op['version']}": op for op in _operators(db, project_id)}
    return [operators[f"{node['operator']}@{node['version']}"] for node in graph["nodes"]]


def _valid_or_raise(db: Session, project_id: str, graph: dict[str, Any]) -> dict[str, Any]:
    result = _validation(db, project_id, graph)
    if not result["valid"]:
        raise HTTPException(422, {"message": "Pipeline 校验失败", "errors": result["errors"]})
    return result


def _pipeline(db: Session, pipeline_id: str, project_id: str) -> Pipeline:
    pipeline = db.get(Pipeline, pipeline_id)
    if pipeline is None or pipeline.project_id != project_id:
        raise HTTPException(404, "Pipeline not found")
    return pipeline


def _version(db: Session, pipeline: Pipeline, version: int | None = None) -> PipelineVersion:
    item = db.scalar(select(PipelineVersion).where(
        PipelineVersion.pipeline_id == pipeline.id,
        PipelineVersion.version == (version or pipeline.latest_version),
    ))
    if item is None:
        raise HTTPException(404, "Pipeline version not found")
    return item


def _pipeline_view(db: Session, pipeline: Pipeline, *, detail: bool = False,
                   version_number: int | None = None) -> dict[str, Any]:
    from .media_models import DagsterExecution
    version = _version(db, pipeline, version_number)
    latest_run = db.execute(select(PipelineRun.id, PipelineRun.status, PipelineRun.pipeline_version,
        PipelineRun.created_at, DagsterExecution.status.label("submission_status")).outerjoin(
            DagsterExecution, DagsterExecution.run_id == PipelineRun.id).where(
                PipelineRun.pipeline_id == pipeline.id, PipelineRun.project_id == pipeline.project_id)
        .order_by(PipelineRun.created_at.desc(), PipelineRun.id.desc()).limit(1)).first()
    result = {
        "id": pipeline.id, "name": version.name, "description": version.description,
        "version": version.version, "graph": version.graph,
        "created_at": pipeline.created_at,
        "updated_at": version.created_at if version_number is not None else pipeline.updated_at,
        "latest_version": pipeline.latest_version,
        "latest_run": None if latest_run is None else {
            "id": latest_run.id, "status": latest_run.status,
            "pipeline_version": latest_run.pipeline_version, "created_at": latest_run.created_at,
            "cancellation_pending": bool(latest_run.status == "cancelled" and latest_run.submission_status
                and latest_run.submission_status not in {"SUCCESS", "FAILURE", "CANCELED"}),
        },
    }
    if detail:
        result["versions"] = [{"version": row.version, "name": row.name, "created_at": row.created_at}
                              for row in db.scalars(select(PipelineVersion).where(
                                  PipelineVersion.pipeline_id == pipeline.id,
                              ).order_by(PipelineVersion.version.desc()))]
    return result


def _artifact_view(artifact: PipelineArtifact, *, detail: bool = False) -> dict[str, Any]:
    result = {
        "id": artifact.id, "run_id": artifact.run_id, "node_id": artifact.node_id,
        "type": artifact.type, "record_count": artifact.record_count,
        "content_hash": artifact.content_hash, "metadata": artifact.payload.get("metadata", {}),
        "parent_artifact_ids": artifact.parent_artifact_ids,
        "cache_origin_id": artifact.cache_origin_id, "created_at": artifact.created_at,
    }
    if detail:
        from itertools import islice
        from .artifact_store import iter_records
        result["records"] = list(islice(iter_records(artifact.payload, artifact.project_id), 100))
        result["manifest"] = artifact.payload.get("manifest")
        result["has_more"] = artifact.record_count > 100
    return result


def _display_operator_snapshot(snapshot: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Historical canvases use frozen contracts, never current plugin readiness.

    Deliberately exclude release execution details such as wheel paths and
    runtime bindings from this read-only display projection.
    """
    fields = (
        "id", "key", "name", "description", "version", "plugin_id", "kind",
        "input_type", "input_ports", "output_type", "config_schema", "default_config",
        "deterministic", "side_effects", "cacheable", "retry_safe",
        "execution_scope", "execution_protocol", "batch_size", "implementation_digest",
    )
    unique = {}
    for manifest in snapshot:
        key = manifest.get("key") or f"{manifest['id']}@{manifest['version']}"
        unique[key] = {field: deepcopy(manifest[field]) for field in fields if field in manifest}
    return list(unique.values())


def _run_view(db: Session, run: PipelineRun, *, reconcile: bool = True,
              include_progress: bool = True) -> dict[str, Any]:
    from .media_jobs import reconcile_run
    from .media_models import DagsterExecution
    from .pipeline_models import PipelineRunSubmission
    if reconcile:
        reconcile_run(db, run)
    from .dispatch_models import PipelineDispatch, PipelineTaskAttempt
    intent = db.get(PipelineDispatch, run.id)
    execution = db.get(DagsterExecution, run.id, populate_existing=True)
    submission = db.scalar(select(PipelineRunSubmission).where(PipelineRunSubmission.run_id == run.id))
    options = submission.request_options if submission and isinstance(submission.request_options, dict) else {}
    use_cache = options.get("use_cache") if isinstance(options.get("use_cache"), bool) else None
    can_retry_submission = bool(run.status == "pending" and execution and not execution.dagster_run_id
        and execution.status in {"SUBMITTING", "REJECTED"})
    can_reconcile_submission = bool(execution and (
        execution.status == "SUBMISSION_UNKNOWN" or
        run.status == "cancelled" and execution.status not in {"SUCCESS", "FAILURE", "CANCELED"}))
    cancellation_pending = bool(run.status == "cancelled" and execution
        and execution.status not in {"SUCCESS", "FAILURE", "CANCELED"})
    execution_status = execution.status if execution else None
    if cancellation_pending:
        display_status = "cancelling"
    elif run.status in {"succeeded", "failed", "cancelled", "interrupted"}:
        display_status = run.status
    elif execution_status == "QUEUED":
        display_status = "queued"
    elif execution_status in {"STARTING", "STARTED"} or run.status == "running":
        display_status = "running"
    else:
        display_status = "pending"
    waiting_reason = {
        "SUBMITTING": "正在提交到 Dagster",
        "SUBMISSION_UNKNOWN": "提交结果未知，等待协调或人工恢复",
        "REJECTED": "Dagster 拒绝了提交，可重试提交",
        "QUEUED": "等待运行协调器分配 Worker",
        "STARTING": "Worker 已分配，正在启动运行",
    }.get(execution_status)
    if intent and intent.status in {"queued", "retry", "dispatching"} and display_status == "pending":
        display_status = "queued"
        waiting_reason = intent.last_error or "等待提交 Worker 与执行资源"
    tasks = list(db.scalars(select(PipelineTaskRun).where(
        PipelineTaskRun.run_id == run.id,
    ).order_by(PipelineTaskRun.position)))
    artifacts = list(db.scalars(select(PipelineArtifact).where(
        PipelineArtifact.run_id == run.id, PipelineArtifact.project_id == run.project_id,
    ).order_by(PipelineArtifact.created_at)))
    from .media_progress import task_progress
    progress = task_progress(db, run, tasks, artifacts) if include_progress else {}
    task_views = []
    for task in tasks:
        view = {field: getattr(task, field) for field in (
            "id", "node_id", "operator", "status", "input_count", "output_count",
            "duration_ms", "error", "artifact_id",
        )}
        if task.id in progress:
            view["progress"] = progress[task.id]
        attempt = db.get(PipelineTaskAttempt, task.id)
        view["attempt"] = {"count": attempt.attempt_count, "status": attempt.status, "heartbeat_at": attempt.heartbeat_at, "execution_key": attempt.execution_key} if attempt else None
        task_views.append(view)
    return {
        "id": run.id, "pipeline_id": run.pipeline_id, "pipeline_name": run.pipeline_name,
        "mode": options.get("mode", "production"), "execution_plan": options.get("execution_plan"),
        "operator_snapshot": _display_operator_snapshot(run.operator_snapshot),
        "pipeline_version": run.pipeline_version, "status": run.status,
        "display_status": display_status, "waiting_reason": waiting_reason,
        "created_at": run.created_at, "finished_at": run.finished_at, "error": run.error,
        "execution_snapshot": intent.execution_snapshot if intent else None,
        "dispatch": {"status": intent.status, "attempts": intent.attempts, "error": intent.last_error} if intent else None,
        "submission_status": execution.status if execution else None,
        "can_retry_submission": can_retry_submission, "use_cache": use_cache,
        "can_reconcile_submission": can_reconcile_submission,
        "cancellation_pending": cancellation_pending,
        "tasks": task_views,
        "artifacts": [_artifact_view(row) for row in artifacts],
    }


@router.get("/operators")
def get_operators(project_id: str = Query(default=settings.default_project_id),
                  context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    return _operators(db, project_id)


@router.get("/operator-plugins")
def get_plugins(project_id: str = Query(default=settings.default_project_id),
                context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    return _registered_plugins(db, project_id)


@router.post("/operator-plugins/register")
def register_plugin(payload: PluginRegister, request: Request,
                    project_id: str = Query(default=settings.default_project_id),
                    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "register", "operators", request)
    plugin = next((item for item in _registered_plugins(db, project_id) if item["id"] == payload.plugin_id), None)
    if plugin is None:
        raise HTTPException(404, "Plugin must first be installed in the server allowlist")
    if not plugin["registered"]:
        db.add(OperatorPluginRegistration(
            project_id=project_id, plugin_id=plugin["id"], version=plugin["version"],
            registered_by=context.effective_user.id,
        ))
        record_audit(db, context, "operators.registered", request, scope=scope,
                     details={"plugin_id": plugin["id"], "version": plugin["version"]})
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            # Concurrent registration of the same installed version is idempotent.
            if not next(item for item in _registered_plugins(db, project_id) if item["id"] == payload.plugin_id)["registered"]:
                raise
    return {**plugin, "registered": True}


@router.get("/pipelines")
def get_pipelines(response: Response, project_id: str = Query(default=settings.default_project_id),
                  q: str = Query(default="", max_length=200),
                  status: Literal["none", "pending", "running", "succeeded", "failed", "cancelled"] | None = None,
                  offset: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=200),
                  paginated: bool = False,
                  context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    query = select(Pipeline).join(PipelineVersion, (PipelineVersion.pipeline_id == Pipeline.id) &
        (PipelineVersion.version == Pipeline.latest_version)).where(Pipeline.project_id == project_id)
    if q.strip():
        query = query.where(or_(PipelineVersion.name.icontains(q.strip(), autoescape=True),
                               PipelineVersion.description.icontains(q.strip(), autoescape=True)))
    if status:
        latest_status = (select(PipelineRun.status).where(PipelineRun.pipeline_id == Pipeline.id,
            PipelineRun.project_id == project_id).order_by(PipelineRun.created_at.desc(), PipelineRun.id.desc())
            .limit(1).correlate(Pipeline).scalar_subquery())
        query = query.where(latest_status.is_(None) if status == "none" else latest_status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = [_pipeline_view(db, row) for row in db.scalars(query.order_by(
        Pipeline.updated_at.desc(), Pipeline.id).offset(offset).limit(limit))]
    response.headers["X-Total-Count"] = str(total)
    return {"items": items, "total": total, "offset": offset, "limit": limit,
            "has_more": offset + len(items) < total} if paginated else items


@router.post("/pipelines/validate")
def check_pipeline(payload: GraphRequest, request: Request,
                   project_id: str = Query(default=settings.default_project_id),
                   context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, request=request)
    return _validation(db, project_id, payload.graph)


@router.post("/pipelines", status_code=201)
def create_pipeline(payload: PipelineCreate, request: Request,
                    project_id: str = Query(default=settings.default_project_id),
                    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "write", request=request)
    _valid_or_raise(db, project_id, payload.graph)
    pipeline = Pipeline(project_id=project_id, created_by=context.effective_user.id)
    db.add(pipeline)
    db.flush()
    db.add(PipelineVersion(pipeline_id=pipeline.id, version=1, name=payload.name,
                           description=payload.description, graph=payload.graph,
                           operator_snapshot=_operator_snapshot(db, project_id, payload.graph),
                           created_by=context.effective_user.id))
    record_audit(db, context, "pipelines.created", request, scope=scope,
                 details={"pipeline_id": pipeline.id, "version": 1})
    db.commit()
    return _pipeline_view(db, pipeline)


@router.get("/pipelines/{pipeline_id}")
def get_pipeline(pipeline_id: str, project_id: str = Query(default=settings.default_project_id),
                 context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    return _pipeline_view(db, _pipeline(db, pipeline_id, project_id), detail=True)


@router.get("/pipelines/{pipeline_id}/versions/{version_number}")
def get_pipeline_version(pipeline_id: str, version_number: int,
                         project_id: str = Query(default=settings.default_project_id),
                         context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    pipeline = _pipeline(db, pipeline_id, project_id)
    if version_number < 1:
        raise HTTPException(404, "Pipeline version not found")
    return _pipeline_view(db, pipeline, version_number=version_number)


@router.post("/pipelines/{pipeline_id}/versions", status_code=201)
def create_version(pipeline_id: str, payload: VersionCreate, request: Request,
                   project_id: str = Query(default=settings.default_project_id),
                   context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "write", request=request)
    pipeline = _pipeline(db, pipeline_id, project_id)
    _valid_or_raise(db, project_id, payload.graph)
    version = payload.expected_version + 1
    changed = db.execute(update(Pipeline).where(
        Pipeline.id == pipeline.id, Pipeline.latest_version == payload.expected_version,
    ).values(latest_version=version, updated_at=utc_now()))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Pipeline 已更新，请重新加载后保存新版本")
    db.add(PipelineVersion(pipeline_id=pipeline.id, version=version, name=payload.name,
                           description=payload.description, graph=payload.graph,
                           operator_snapshot=_operator_snapshot(db, project_id, payload.graph),
                           created_by=context.effective_user.id))
    record_audit(db, context, "pipelines.version_created", request, scope=scope,
                 details={"pipeline_id": pipeline.id, "version": version})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Pipeline 已更新，请重新加载后保存新版本") from None
    db.refresh(pipeline)
    return _pipeline_view(db, pipeline)


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _execution_plan(db: Session, project_id: str, pipeline: Pipeline, payload: RunPlanCreate):
    from .pipeline_plans import PlanError, build_plan
    from .execution_resources import freeze_execution
    version = _version(db, pipeline, payload.version)
    _valid_or_raise(db, project_id, version.graph)
    snapshot = _operator_snapshot(db, project_id, version.graph)
    if [(op["key"], op["implementation_digest"]) for op in snapshot] != [
        (op["key"], op["implementation_digest"]) for op in version.operator_snapshot
    ]:
        raise HTTPException(409, "算子实现已变化，请保存新的 Pipeline 版本后运行")
    try:
        execution_snapshot = freeze_execution(db, project_id, payload.environment_id, payload.worker_pool_id)
        if payload.mode == "debug" and execution_snapshot.get("resource_kind") != "cpu":
            raise ValueError("第一阶段小样本文档调试仅支持 CPU 执行资源")
        plan = build_plan(version.graph, snapshot, version=version.version, mode=payload.mode,
            targets=payload.targets, sample_limit=payload.sample_limit, use_cache=payload.use_cache,
            environment_id=payload.environment_id, worker_pool_id=payload.worker_pool_id,
            execution_binding=execution_snapshot)
    except PlanError as error:
        raise HTTPException(422, {"message": "运行计划校验失败", "errors": error.errors,
            "blocked": error.blocked}) from None
    except ValueError as error:
        raise HTTPException(422, {"message": "执行环境不可用", "errors": [str(error)], "blocked": []}) from None
    if payload.plan_digest is not None and payload.plan_digest != plan["plan_digest"]:
        raise HTTPException(409, "运行计划已变化，请重新预检后提交")
    return version, snapshot, plan, execution_snapshot


@router.post("/pipelines/{pipeline_id}/run-plan")
def preview_run_plan(pipeline_id: str, payload: RunPlanCreate, request: Request,
                     project_id: str = Query(default=settings.default_project_id),
                     context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, "run", request=request)
    pipeline = _pipeline(db, pipeline_id, project_id)
    _, _, plan, _ = _execution_plan(db, project_id, pipeline, payload)
    return plan


@router.post("/projects/{project_id}/pipelines/{pipeline_id}/run-plan")
def preview_project_run_plan(project_id: str, pipeline_id: str, payload: RunPlanCreate, request: Request,
                            context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    return preview_run_plan(pipeline_id, payload, request, project_id, context, db)


@router.post("/pipelines/{pipeline_id}/runs", status_code=202)
def create_run(pipeline_id: str, payload: RunCreate, request: Request,
               project_id: str = Query(default=settings.default_project_id),
               context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    from .media_api import start_media_run
    return start_media_run(pipeline_id, payload, request, project_id, context, db)


@router.get("/pipeline-runs")
def get_runs(response: Response, project_id: str = Query(default=settings.default_project_id),
             pipeline_id: str | None = None, limit: int = Query(default=50, ge=1, le=100),
             pipeline_version: int | None = Query(default=None, ge=1),
             offset: int = Query(default=0, ge=0), paginated: bool = False,
             status: Literal["pending", "queued", "running", "succeeded", "failed", "cancelled", "cancelling", "interrupted"] | None = None,
             context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    query = select(PipelineRun).where(PipelineRun.project_id == project_id)
    if pipeline_id:
        _pipeline(db, pipeline_id, project_id)
        query = query.where(PipelineRun.pipeline_id == pipeline_id)
    if status:
        from .media_models import DagsterExecution
        queued_runs = select(DagsterExecution.run_id).where(DagsterExecution.status == "QUEUED")
        active_executions = select(DagsterExecution.run_id).where(
            DagsterExecution.status.not_in({"SUCCESS", "FAILURE", "CANCELED"}))
        if status == "queued":
            query = query.where(PipelineRun.id.in_(queued_runs))
        elif status == "pending":
            query = query.where(PipelineRun.status == "pending", ~PipelineRun.id.in_(queued_runs))
        elif status == "running":
            query = query.where(
                PipelineRun.status.in_({"pending", "running"}),
                or_(
                    PipelineRun.status == "running",
                    PipelineRun.id.in_(select(DagsterExecution.run_id).where(
                        DagsterExecution.status.in_({"STARTING", "STARTED"}))),
                ),
            )
        elif status == "cancelling":
            query = query.where(PipelineRun.status == "cancelled", PipelineRun.id.in_(active_executions))
        else:
            query = query.where(PipelineRun.status == status)
    if pipeline_version is not None:
        query = query.where(PipelineRun.pipeline_version == pipeline_version)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    # A list is a read of the SQL projection. It must not do one network request
    # per row, nor infer mutable file progress for historical runs.
    items = [_run_view(db, row, reconcile=False, include_progress=False) for row in db.scalars(
        query.order_by(PipelineRun.created_at.desc(), PipelineRun.id.desc()).offset(offset).limit(limit))]
    response.headers["X-Total-Count"] = str(total)
    return {"items": items, "total": total, "offset": offset, "limit": limit,
            "has_more": offset + len(items) < total} if paginated else items


@router.get("/projects/{project_id}/runs")
def get_project_runs(response: Response, project_id: str,
                     pipeline_id: str | None = None, limit: int = Query(default=50, ge=1, le=100),
                     pipeline_version: int | None = Query(default=None, ge=1),
                     offset: int = Query(default=0, ge=0), paginated: bool = False,
                     status: Literal["pending", "queued", "running", "succeeded", "failed", "cancelled", "cancelling", "interrupted"] | None = None,
                     context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    return get_runs(response, project_id=project_id, pipeline_id=pipeline_id, limit=limit,
                    pipeline_version=pipeline_version, offset=offset, paginated=paginated,
                    status=status, context=context, db=db)


@router.get("/pipeline-runs/{run_id}")
def get_run(run_id: str, project_id: str = Query(default=settings.default_project_id),
            context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    run = db.get(PipelineRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(404, "Run not found")
    return _run_view(db, run)


@router.get("/projects/{project_id}/runs/{run_id}")
def get_project_run(project_id: str, run_id: str,
                    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    return get_run(run_id, project_id=project_id, context=context, db=db)


@router.get("/pipeline-artifacts/{artifact_id}")
def get_artifact(artifact_id: str, project_id: str = Query(default=settings.default_project_id),
                 context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    artifact = db.get(PipelineArtifact, artifact_id)
    if artifact is None or artifact.project_id != project_id:
        raise HTTPException(404, "Artifact not found")
    return _artifact_view(artifact, detail=True)


@router.get("/pipeline-artifacts/{artifact_id}/export")
def export_artifact(artifact_id: str, project_id: str = Query(default=settings.default_project_id),
                    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    artifact = db.get(PipelineArtifact, artifact_id)
    if artifact is None or artifact.project_id != project_id:
        raise HTTPException(404, "Artifact not found")
    # Detach the immutable manifest before the request transaction closes. Each
    # shard is checksum-verified by iter_records without loading the full result.
    from .artifact_store import canonical, iter_records
    stored = deepcopy(artifact.payload)

    def rows():
        for record in iter_records(stored, project_id):
            yield canonical(record) + b"\n"

    return StreamingResponse(rows(), media_type="application/x-ndjson", headers={
        "Content-Disposition": f'attachment; filename="artifact-{UUID(artifact_id)}.jsonl"',
        "X-Record-Count": str(artifact.record_count),
        "Cache-Control": "private, no-store",
    })


def interrupt_unfinished_runs(db: Session) -> int:
    """Only legacy local runs are interrupted by an API restart.

    Dagster-managed runs continue independently and are reconciled from the
    framework, never marked failed merely because the API process restarted.
    """
    from .media_models import DagsterExecution
    from .dispatch_models import PipelineDispatch
    runs = list(db.scalars(select(PipelineRun).where(
        PipelineRun.status.in_(["pending", "running"]),
        ~PipelineRun.id.in_(select(DagsterExecution.run_id)),
        ~PipelineRun.id.in_(select(PipelineDispatch.run_id)),
    )))
    for run in runs:
        run.status, run.finished_at = "failed", utc_now()
        run.error = "历史本地执行器运行已中断；请使用 Dagster 重新提交"
        for task in db.scalars(select(PipelineTaskRun).where(PipelineTaskRun.run_id == run.id)):
            if task.status in {"pending", "running"}:
                task.status = "failed" if task.status == "running" else "skipped"
                task.error = run.error
    db.commit()
    return len(runs)
