"""Media catalog, scoped file serving/search, and asynchronous Dagster runs."""

import base64
from copy import deepcopy
import importlib
import hashlib
import json
import math
import time
from typing import Any, Literal
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import AuthContext, get_auth_context, record_audit
from .config import settings
from .database import get_db
from . import media_jobs
from .media_models import DagsterExecution, Keyframe, MediaIndexPublication, ShotAsset, VideoAsset
from .media_query import SearchRequest, filtered_shots
from .media_store import media_path
from .models import utc_now
from .pipeline_api import (PipelineCreate, PipelineRoute, RunCreate, _access, _operator_snapshot,
                           _pipeline, _pipeline_view, _run_view, _valid_or_raise, _version, _execution_plan)
from .pipeline_models import (OperatorPluginRegistration, Pipeline, PipelineRun, PipelineRunSubmission, PipelineTaskRun,
                              PipelineVersion)


router = APIRouter(prefix="/api/media", tags=["media"], route_class=PipelineRoute)


class DemoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    urls: list[str] | None = Field(default=None, min_length=1, max_length=5)


class VideoImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    object_uri: str
    title: str = Field(min_length=1, max_length=160)
    idempotency_key: UUID

    @field_validator("object_uri")
    @classmethod
    def valid_source(cls, value):
        from .media_object_ingest import ObjectVideoConfig
        ObjectVideoConfig(object_uris=[value])
        return value

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("视频标题不能为空")
        return value


def _import_source_matches(version: PipelineVersion, payload: VideoImportRequest) -> bool:
    """Compare the request identity, independent of changing operator defaults."""
    sources = [node for node in version.graph['nodes'] if node['operator'] == 'media.object_ingest']
    if len(sources) != 1:
        return False
    config = sources[0]['config']
    return (config.get('object_uris') == [payload.object_uri]
            and config.get('titles') == {payload.object_uri: payload.title})


def _file_url(asset_id: str, kind: str, project_id: str) -> str:
    return f"/api/media/files/{asset_id}?{urlencode({'kind': kind, 'project_id': project_id})}"


@router.get("/status")
def media_status(project_id: str = Query(default=settings.default_project_id),
                 context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, resource="media")
    result: dict[str, Any] = {"models": [], "issues": []}
    try:
        module = importlib.import_module(".media_plugin", package=__package__)
        result.update(module.preflight())
    except (ImportError, AttributeError) as error:
        result["issues"] = [f"媒体推理适配器尚未就绪：{type(error).__name__}"]
    except Exception as error:
        result["issues"] = [f"模型环境检查失败：{str(error)[:500]}"]
    result["counts"] = {name: db.scalar(select(func.count()).select_from(model).where(model.project_id == project_id)) or 0
                        for name, model in (("videos", VideoAsset), ("shots", ShotAsset), ("keyframes", Keyframe))}
    result["counts"]["indexed_shots"] = db.scalar(select(func.count()).select_from(ShotAsset).where(
        ShotAsset.project_id == project_id, ShotAsset.index_state == "ready")) or 0
    result["counts"]["indexed_videos"] = db.scalar(select(func.count(func.distinct(ShotAsset.video_id))).where(
        ShotAsset.project_id == project_id, ShotAsset.index_state == "ready")) or 0
    result["latest_published_at"] = db.scalar(select(func.max(PipelineRun.finished_at)).join(
        ShotAsset, ShotAsset.index_run_id == PipelineRun.id).where(
        ShotAsset.project_id == project_id, ShotAsset.index_state == "ready", PipelineRun.project_id == project_id))
    executor = media_jobs.executor_status()
    if executor["active_run_id"]:
        run = db.get(PipelineRun, executor["active_run_id"])
        if run is None or run.project_id != project_id:
            executor["active_run_id"] = None
    result["executor"] = executor
    from .media_multimodal import availability
    result["retrieval"] = {"multimodal": availability(project_id), "baseline": {"available": True}}
    return result


@router.get("/videos")
def list_videos(project_id: str = Query(default=settings.default_project_id),
                context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, resource="media")
    counts = dict(db.execute(select(ShotAsset.video_id, func.count()).where(
        ShotAsset.project_id == project_id).group_by(ShotAsset.video_id)).all())
    return [{"id": video.id, "title": video.title, "source_url": video.source_url,
             "duration_ms": video.duration_ms, "shot_count": counts.get(video.id, 0),
             "video_url": _file_url(video.id, "video", project_id), "created_at": video.created_at}
            for video in db.scalars(select(VideoAsset).where(VideoAsset.project_id == project_id)
                                     .order_by(VideoAsset.created_at.desc()).limit(200))]


@router.get("/files/{asset_id}")
def media_file(asset_id: str, kind: Literal["video", "frame", "mask"] = "frame",
               project_id: str = Query(default=settings.default_project_id),
               context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, resource="media")
    row = db.get(VideoAsset if kind == "video" else Keyframe, asset_id)
    if row is None or row.project_id != project_id:
        raise HTTPException(404, "Media asset not found")
    stored_path = row.mask_path if kind == "mask" else row.path
    if not stored_path:
        raise HTTPException(404, "Media asset file not found")
    try:
        path = media_path(stored_path, project_id, must_exist=True)
    except (ValueError, FileNotFoundError, OSError):
        raise HTTPException(404, "Media asset file not found") from None
    # Starlette's FileResponse supports byte Range for original-video seeking.
    # MIME is inferred from the stored filename; user paths never enter lookup.
    return FileResponse(path, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


def _shot_view(db: Session, shot: ShotAsset, frame_id: str | None = None,
               score: float | None = None) -> dict[str, Any]:
    video = db.get(VideoAsset, shot.video_id)
    if video is None or video.project_id != shot.project_id:
        raise ValueError("Media video reference is invalid")
    frame = db.get(Keyframe, frame_id) if frame_id else None
    if frame is None or frame.project_id != shot.project_id or frame.shot_id != shot.id:
        frame = db.scalar(select(Keyframe).where(Keyframe.project_id == shot.project_id,
                                                 Keyframe.shot_id == shot.id).order_by(Keyframe.timestamp_ms).limit(1))
    publication_run = db.get(PipelineRun, shot.index_run_id) if shot.index_run_id else None
    if publication_run and publication_run.project_id != shot.project_id:
        publication_run = None
    return {"id": shot.id, "video_id": video.id, "video_title": video.title, "title": video.title,
            "start_ms": shot.start_ms, "end_ms": shot.end_ms, "duration_ms": shot.end_ms - shot.start_ms,
            "person_status": shot.person_status, "index_state": shot.index_state, "frame_count": shot.frame_count,
            "keyframe_url": _file_url(frame.id, "frame", shot.project_id) if frame else None,
            "video_url": _file_url(video.id, "video", shot.project_id),
            "mask_url": _file_url(frame.id, "mask", shot.project_id) if frame and frame.mask_path else None,
            "score": score, "matched_frame_id": frame.id if frame else None,
            "matched_timestamp_ms": frame.timestamp_ms if frame else None,
            "segmentation_model": frame.model_revision if frame else None,
            "embedding_model": shot.embedding_model, "embedding_spaces": shot.embedding_spaces,
            "detections": frame.detections if frame else [], "index_run_id": shot.index_run_id,
            "index_pipeline_id": publication_run.pipeline_id if publication_run else None,
            "index_pipeline_version": publication_run.pipeline_version if publication_run else None}


def _search_media_results(payload: SearchRequest, project_id: str, db: Session):
    if payload.video_id:
        video = db.get(VideoAsset, payload.video_id)
        if video is None or video.project_id != project_id:
            raise HTTPException(404, "Video not found")
    query = filtered_shots(payload, project_id)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    if payload.mode == "filter":
        rows = list(db.scalars(query.order_by(ShotAsset.created_at.desc(), ShotAsset.index).limit(payload.limit)))
        return {"items": [_shot_view(db, row) for row in rows], "total": total, "mode": payload.mode,
                "embedding_space": payload.embedding_space, "score_type": "catalog",
                "retrieval": {"profile": "catalog", "route": "sql-filters", "reranked": False,
                              "candidate_count": total, "limitations": []}}
    try:
        module = importlib.import_module(".media_search", package=__package__)
        hits = module.search(project_id=project_id, **payload.model_dump())
    except ImportError:
        raise HTTPException(503, "语义检索服务尚未就绪；请完成模型与 Milvus 环境配置") from None
    except ValueError as error:
        raise HTTPException(422, str(error)[:1000]) from None
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, f"语义检索暂不可用：{str(error)[:1000]}") from None
    score_type = "cosine"
    retrieval = {}
    if isinstance(hits, dict):
        score_type = hits.get("score_type", "cosine")
        retrieval = hits.get("retrieval", {})
        hits = hits.get("items", [])
    if not isinstance(hits, list):
        raise HTTPException(503, "语义检索服务返回了无效响应")
    # Treat vector backend metadata as a candidate list, never as authorization.
    # Recheck publication state + tenant and requested scalar filters in SQL.
    items, seen = [], set()
    for hit in hits[:1000]:
        if not isinstance(hit, dict):
            continue
        shot_id = hit.get("shot_id") or hit.get("id")
        if not isinstance(shot_id, str) or shot_id in seen:
            continue
        row = db.scalar(query.where(ShotAsset.id == shot_id))
        if row is None:
            continue
        if "source_index_run_id" in hit and hit["source_index_run_id"] != row.index_run_id:
            continue
        if hit.get("collection_name"):
            current_collections = {value.get("name") for value in json.loads(row.collection or "{}").values()}
            if hit["collection_name"] not in current_collections:
                continue
        if hit.get("catalog_identity"):
            from .media_multimodal import catalog_identity
            video = db.get(VideoAsset, row.video_id)
            if video is None or hit["catalog_identity"] != catalog_identity(row, video):
                continue
        raw_score = hit.get("score")
        score = float(raw_score) if isinstance(raw_score, (int, float)) and not isinstance(raw_score, bool) else None
        if score is not None and not math.isfinite(score):
            continue
        frame_id = hit.get("frame_id") or hit.get("matched_frame_id")
        if not isinstance(frame_id, str):
            frame_id = None
        item = _shot_view(db, row, frame_id, score)
        item["spaces"] = [space for space in hit.get("spaces", []) if space in {"image", "video"}]
        item["retrieval_route"] = str(hit.get("retrieval_route", "baseline"))[:100]
        evidence = hit.get("evidence", {})
        item["evidence"] = {key: evidence[key] for key in ("unit", "coverage", "frame_ids", "retrieval_score", "reranker_score", "exclude_score", "sample_timestamps_ms", "sampling_revision", "routes", "fusion_score") if isinstance(evidence, dict) and key in evidence}
        items.append(item)
        seen.add(shot_id)
        if len(items) == payload.limit:
            break
    return {"items": items, "total": len(items), "eligible_shots": total, "mode": payload.mode,
            "embedding_space": payload.embedding_space, "retrieval": retrieval,
            "score_type": score_type if score_type in {"rrf", "cosine", "reranker", "semantic_penalty"} else "cosine"}


@router.post("/search")
def search_media(payload: SearchRequest, request: Request,
                 project_id: str = Query(default=settings.default_project_id),
                 context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "search", "media", request=request)
    started = time.monotonic()
    # Filter-only catalog preloads are reads. Explicit filter clicks and semantic
    # searches are business actions; never log query text or uploaded image data.
    from .insights_catalog import SAFE_ID
    explicit = payload.mode != "filter" or bool(SAFE_ID.fullmatch(request.headers.get("x-interaction-id", "")))
    try:
        if payload.reference_shot_id:
            reference = db.scalar(select(ShotAsset).where(ShotAsset.project_id == project_id,
                ShotAsset.id == payload.reference_shot_id, ShotAsset.index_state == "ready"))
            if reference is None:
                raise HTTPException(404, "Reference shot not found")
            frame_query = select(Keyframe).where(Keyframe.project_id == project_id, Keyframe.shot_id == reference.id)
            if payload.reference_frame_id:
                frame_query = frame_query.where(Keyframe.id == payload.reference_frame_id)
            frame = db.scalar(frame_query.order_by(Keyframe.timestamp_ms).limit(1))
            if frame is None:
                raise HTTPException(422, "参考镜头缺少关键帧")
            # Freeze the actual displayed visual reference for saved replay;
            # later catalog generation changes cannot replace the input image.
            try:
                source = media_path(frame.path, project_id, must_exist=True)
                image = base64.b64encode(source.read_bytes()).decode()
                payload = SearchRequest(**{**payload.model_dump(), "reference_shot_id": None, "reference_frame_id": None,
                                           "image_base64": image})
            except (OSError, ValueError) as error:
                raise HTTPException(422, f"参考图片不可用：{str(error)[:300]}") from None
        result = _search_media_results(payload, project_id, db)
        from .media_curation import record_search_session, shot_tags
        tags = shot_tags(db, project_id, [item["id"] for item in result["items"]])
        for item in result["items"]:
            item["tags"] = tags[item["id"]]
        result["elapsed_ms"] = round((time.monotonic() - started) * 1000, 3)
        result.setdefault("retrieval", {})["elapsed_ms"] = result["elapsed_ms"]
        result["retrieval"]["latency_scope"] = "query_planning_lock_wait_inference_retrieval_before_persistence"
        result["search_id"] = record_search_session(db, project_id, context.effective_user.id,
                                                     payload.model_dump(), result)
    except Exception as error:
        if explicit:
            db.rollback()
            record_audit(db, context, "media.search.failed", request, scope=scope,
                         details={"mode": payload.mode, "error_code": error.status_code if isinstance(error, HTTPException) else 500})
            db.commit()
        raise
    if explicit:
        record_audit(db, context, "media.search.succeeded", request, scope=scope,
                     details={"mode": payload.mode, "result_count": len(result["items"])})
    db.commit()
    return result


@router.post("/pipelines/{pipeline_id}/runs", status_code=202)
def start_media_run(pipeline_id: str, payload: RunCreate, request: Request,
                    project_id: str = Query(default=settings.default_project_id),
                    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "run", request=request)
    pipeline = _pipeline(db, pipeline_id, project_id)
    submission_id = None
    hash_options = [pipeline_id, payload.version, payload.use_cache]
    if payload.environment_id or payload.worker_pool_id:
        hash_options.extend([payload.environment_id, payload.worker_pool_id])
    if payload.mode != "production" or payload.targets is not None or payload.sample_limit is not None or payload.plan_digest:
        hash_options.append({"mode": payload.mode, "targets": sorted(set(payload.targets or [])),
            "sample_limit": (payload.sample_limit or 20) if payload.mode == "debug" else payload.sample_limit,
            "plan_digest": payload.plan_digest})
    request_hash = hashlib.sha256(json.dumps(hash_options,
                                             separators=(",", ":")).encode()).hexdigest()
    if payload.idempotency_key is not None:
        scope_key = json.dumps([project_id, context.actor.id, context.effective_user.id,
                                str(payload.idempotency_key)], separators=(",", ":"))
        submission_id = str(uuid5(NAMESPACE_URL, "data-flywheel/run/" + scope_key))
        existing = db.get(PipelineRunSubmission, submission_id)
        if existing is not None:
            if existing.request_hash != request_hash:
                raise HTTPException(409, "同一次提交标识不能用于不同的运行参数")
            return _run_view(db, db.get(PipelineRun, existing.run_id))
    version, snapshot, plan, execution_snapshot = _execution_plan(db, project_id, pipeline, payload)
    selected_keys = {f"{node['operator']}@{node['version']}" for node in plan["graph"]["nodes"]}
    snapshot = [item for item in snapshot if item["key"] in selected_keys]
    from .dispatch_worker import enqueue_run
    run = PipelineRun(project_id=project_id, pipeline_id=pipeline.id, pipeline_name=version.name,
                      pipeline_version=version.version, graph=deepcopy(plan["graph"]),
                      operator_snapshot=deepcopy(snapshot), status="pending",
                      actor_user_id=context.actor.id, effective_user_id=context.effective_user.id)
    db.add(run)
    db.flush()
    # Even callers without an idempotency key need durable retry options. Their
    # generated submission ID is intentionally not reusable by another request.
    db.add(PipelineRunSubmission(id=submission_id or str(uuid4()), run_id=run.id, request_hash=request_hash,
        request_options={"version": version.version, "use_cache": payload.use_cache,
            "mode": payload.mode, "execution_plan": deepcopy(plan)}))
    if submission_id is not None:
        try:
            db.flush()
        except IntegrityError:
            # A parallel request may have won the unique launch-intent claim.
            # Roll back this entire run before returning the winner; never
            # dispatch a second Dagster job after an uncertain HTTP response.
            db.rollback()
            existing = db.get(PipelineRunSubmission, submission_id)
            if existing is None or existing.request_hash != request_hash:
                raise HTTPException(409, "提交标识冲突，请检查运行参数") from None
            return _run_view(db, db.get(PipelineRun, existing.run_id))
    name = media_jobs.debug_job_name(run.id) if payload.mode == "debug" else media_jobs.job_name(pipeline.id, version.version)
    db.add(DagsterExecution(run_id=run.id, job_name=name))
    nodes = {node["id"]: node for node in plan["graph"]["nodes"]}
    db.add_all([PipelineTaskRun(run_id=run.id, node_id=node_id, position=index,
                               operator=nodes[node_id]["operator"])
                for index, node_id in enumerate(plan["node_ids"])])
    record_audit(db, context, "framework.run_started", request, scope=scope,
                 details={"pipeline_id": pipeline.id, "run_id": run.id, "version": version.version,
                          "mode": payload.mode, "plan_digest": plan["plan_digest"]})
    enqueue_run(db, run, payload.use_cache, execution_snapshot)
    db.commit()
    db.refresh(run)
    return _run_view(db, run)


start_framework_run = start_media_run


@router.post("/imports", status_code=202)
def import_video(payload: VideoImportRequest, request: Request,
                 project_id: str = Query(default=settings.default_project_id),
                 context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    """Create a local-model pipeline and enqueue it through the normal dispatcher."""
    scope = _access(db, context, project_id, "write", request=request)
    _access(db, context, project_id, "run")
    _access(db, context, project_id, "register", "operators")
    from .object_storage import ObjectStore
    try:
        ObjectStore(project_id).key_from_uri(payload.object_uri)
    except ValueError:
        raise HTTPException(422, "视频源必须属于当前项目对象存储") from None
    scope_key = json.dumps([project_id, context.actor.id, context.effective_user.id,
                            str(payload.idempotency_key)], separators=(",", ":"))
    pipeline_id = str(uuid5(NAMESPACE_URL, "data-flywheel/video-import/" + scope_key))
    pipeline = db.get(Pipeline, pipeline_id)
    if pipeline is not None:
        if not _import_source_matches(_version(db, pipeline, 1), payload):
            raise HTTPException(409, "同一次导入标识不能用于不同的视频或标题")
    else:
        from .media_plugin import plugin as installed_plugin
        plugin = installed_plugin()
        operators = {op.id: op for op in plugin.operators}
        sequence = ["object_ingest", "autoshot", "keyframes", "person_segment", "siglip2_embed", "milvus_publish"]
        nodes = []
        for identifier in sequence:
            definition = operators["media." + identifier]
            config = deepcopy(definition.default_config)
            if identifier == "object_ingest":
                config = {"object_uris": [payload.object_uri], "titles": {payload.object_uri: payload.title}}
            nodes.append({"id": identifier, "operator": definition.id, "version": definition.version,
                          "config": config, "inputs": {"data": nodes[-1]["id"]} if nodes else {}})
        graph = {"nodes": nodes}
        registration = db.scalar(select(OperatorPluginRegistration).where(
            OperatorPluginRegistration.project_id == project_id,
            OperatorPluginRegistration.plugin_id == plugin.id,
            OperatorPluginRegistration.version == plugin.version))
        if registration is None:
            try:
                with db.begin_nested():
                    db.add(OperatorPluginRegistration(project_id=project_id, plugin_id=plugin.id,
                        version=plugin.version, registered_by=context.effective_user.id))
                    db.flush()
                record_audit(db, context, "operators.registered", request, scope=scope,
                             details={"plugin_id": plugin.id, "version": plugin.version})
            except IntegrityError:
                pass
        _valid_or_raise(db, project_id, graph)
        try:
            with db.begin_nested():
                pipeline = Pipeline(id=pipeline_id, project_id=project_id, created_by=context.effective_user.id)
                db.add(pipeline)
                db.flush()
                db.add(PipelineVersion(pipeline_id=pipeline.id, version=1, name="视频实验室 · " + payload.title[:150],
                    description="上传视频、AutoShot、真实关键帧、人物分割、SigLIP2 与本地 Milvus 检索。",
                    graph=graph, operator_snapshot=_operator_snapshot(db, project_id, graph),
                    created_by=context.effective_user.id))
                db.flush()
        except IntegrityError:
            pipeline = db.get(Pipeline, pipeline_id)
            if pipeline is None or not _import_source_matches(_version(db, pipeline, 1), payload):
                raise HTTPException(409, "导入标识冲突，请检查视频参数") from None
        record_audit(db, context, "pipelines.created", request, scope=scope,
                     details={"pipeline_id": pipeline_id, "version": 1, "template": "media.local-video"})
    # The normal launch intent handles uncertain HTTP outcomes, dispatch,
    # frozen implementation snapshots and success-only publication.
    result = start_media_run(pipeline_id, RunCreate(version=1, idempotency_key=payload.idempotency_key),
                             request, project_id, context, db)
    return {**result, "run_id": result["id"]}


@router.post("/runs/{run_id}/retry-submission", status_code=202)
def retry_submission(run_id: str, request: Request, payload: RunCreate,
                      project_id: str = Query(default=settings.default_project_id),
                      context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "run", request=request)
    run = db.get(PipelineRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(404, "Run not found")
    if run.status != "pending":
        raise HTTPException(409, "仅未确认提交的待运行记录可以重试提交")
    execution = db.get(DagsterExecution, run.id)
    if execution and execution.status == "SUBMISSION_UNKNOWN":
        raise HTTPException(409, "提交结果尚未确认，请刷新执行状态或取消该运行；查无记录不能保证重复提交安全")
    if not execution or execution.dagster_run_id or execution.status not in {"SUBMITTING", "REJECTED"}:
        raise HTTPException(409, "该运行没有可恢复的未确认提交")
    submission = db.scalar(select(PipelineRunSubmission).where(PipelineRunSubmission.run_id == run.id))
    options = submission.request_options if submission and isinstance(submission.request_options, dict) else {}
    use_cache = options.get("use_cache") if isinstance(options.get("use_cache"), bool) else payload.use_cache
    from .dispatch_worker import requeue_run
    try:
        requeue_run(db, run, use_cache)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    record_audit(db, context, "framework.submission_retried", request, scope=scope, details={"run_id": run.id})
    db.commit()
    db.refresh(run)
    return _run_view(db, run)


@router.post("/runs/{run_id}/reconcile")
def reconcile_submission(run_id: str, request: Request,
                         project_id: str = Query(default=settings.default_project_id),
                         context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, request=request)
    run = db.get(PipelineRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(404, "Run not found")
    media_jobs.reconcile_run(db, run)
    record_audit(db, context, "framework.submission_reconciled", request, scope=scope,
                 details={"run_id": run.id, "status": run.status})
    db.commit()
    return _run_view(db, run, reconcile=False)


@router.post("/runs/{run_id}/cancel")
def cancel_media_run(run_id: str, request: Request,
                     project_id: str = Query(default=settings.default_project_id),
                     context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "cancel", request=request)
    run = db.get(PipelineRun, run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(404, "Run not found")
    if run.status == "cancelled":
        return _run_view(db, run)
    if run.status not in {"pending", "running"}:
        raise HTTPException(409, "运行已经结束，无法取消")
    record_audit(db, context, "media.run_cancellation_requested", request, scope=scope,
                 details={"run_id": run_id, "status": run.status})
    db.commit()
    try:
        media_jobs.cancel(run.id)
    except Exception as error:
        raise HTTPException(503, f"Dagster 取消失败：{str(error)[:500]}") from None
    execution = db.get(DagsterExecution, run.id, populate_existing=True)
    cancellation_message = ("已取消平台运行；正在确认并终止可能迟到的 Dagster 任务"
        if execution and execution.status == "CANCEL_REQUESTED" else "用户已取消；Dagster 正在终止运行进程")
    changed = db.execute(update(PipelineRun).where(PipelineRun.id == run_id,
                                                   PipelineRun.status.in_(["pending", "running", "cancelled"])).values(
        status="cancelled", finished_at=utc_now(), error=cancellation_message))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "运行已经结束，无法取消")
    db.execute(update(PipelineTaskRun).where(PipelineTaskRun.run_id == run_id,
                                            PipelineTaskRun.status.in_(["pending", "running"])).values(
        status="cancelled", error="用户取消运行"))
    db.execute(update(MediaIndexPublication).where(MediaIndexPublication.project_id == project_id,
        MediaIndexPublication.run_id == run_id, MediaIndexPublication.status == "staged").values(status="failed"))
    record_audit(db, context, "media.run_cancelled", request, scope=scope, details={"run_id": run_id})
    db.commit()
    db.refresh(run)
    return _run_view(db, run)


@router.post("/demo-pipeline", status_code=201)
def create_demo_pipeline(request: Request, payload: DemoRequest | None = None,
                         project_id: str = Query(default=settings.default_project_id),
                         context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "write", request=request)
    _access(db, context, project_id, "register", "operators")
    try:
        module = importlib.import_module(".media_plugin", package=__package__)
        plugin = module.plugin()
        graph = module.demo_graph(payload.urls) if payload and payload.urls else module.demo_graph()
    except (ImportError, AttributeError):
        raise HTTPException(503, "媒体算子插件尚未安装") from None
    existing = db.scalar(select(OperatorPluginRegistration).where(
        OperatorPluginRegistration.project_id == project_id,
        OperatorPluginRegistration.plugin_id == plugin.id, OperatorPluginRegistration.version == plugin.version))
    if existing is None:
        inserted = False
        try:
            with db.begin_nested():
                db.add(OperatorPluginRegistration(project_id=project_id, plugin_id=plugin.id,
                    version=plugin.version, registered_by=context.effective_user.id))
                db.flush()
                inserted = True
        except IntegrityError:
            # Another request may register the same installed version while
            # this request builds its template. Roll back only that savepoint.
            registered = db.scalar(select(OperatorPluginRegistration).where(
                OperatorPluginRegistration.project_id == project_id,
                OperatorPluginRegistration.plugin_id == plugin.id,
                OperatorPluginRegistration.version == plugin.version))
            if registered is None:
                raise
        if inserted:
            record_audit(db, context, "operators.registered", request, scope=scope,
                         details={"plugin_id": plugin.id, "version": plugin.version})
    definition = PipelineCreate(name="长视频 → Shot 检索", description="YouTube 入库、AutoShot、关键帧人物分割、多模态向量与 Milvus 检索", graph=graph)
    _valid_or_raise(db, project_id, definition.graph)
    pipeline = Pipeline(project_id=project_id, created_by=context.effective_user.id)
    db.add(pipeline)
    db.flush()
    db.add(PipelineVersion(pipeline_id=pipeline.id, version=1, name=definition.name,
                           description=definition.description, graph=definition.graph,
                           operator_snapshot=_operator_snapshot(db, project_id, graph),
                           created_by=context.effective_user.id))
    record_audit(db, context, "pipelines.created", request, scope=scope,
                 details={"pipeline_id": pipeline.id, "version": 1, "template": "media.video"})
    db.commit()
    return {**_pipeline_view(db, pipeline), "pipeline_id": pipeline.id}
