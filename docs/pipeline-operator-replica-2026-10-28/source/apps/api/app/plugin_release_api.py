"""Project-scoped candidate upload, validation, publication and activation."""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import AuthContext, get_auth_context, record_audit, require_permission, verify_csrf
from .config import settings
from .database import get_db
from .models import Project
from .plugin_release_models import PluginRelease, PluginReleaseActivation, PluginValidation
from . import plugin_release_service as service
from .rbac import Scope

router = APIRouter(prefix="/api/plugin-releases", tags=["plugin-releases"])


def _access(db, context, project_id, action="read", request=None):
    scope = Scope("project", project_id)
    require_permission(db, context, scope, "pipelines", "read")
    if action != "read":
        require_permission(db, context, scope, "operators", action)
    if db.get(Project, project_id) is None:
        raise HTTPException(404, "Project not found")
    if request is not None:
        verify_csrf(request, context)
    return scope


def _release(db, release_id, project_id):
    release = db.scalar(select(PluginRelease).where(PluginRelease.id == release_id, PluginRelease.project_id == project_id))
    if release is None:
        raise HTTPException(404, "Plugin release not found")
    return release


def _validation_view(row):
    return {field: getattr(row, field) for field in ("id", "release_id", "status", "wheel_sha256", "runtime_digest",
        "sdk_bundle_digest", "report", "error", "created_at", "started_at", "finished_at")}


def _view(db, row):
    validation = db.get(PluginValidation, row.validation_id) if row.validation_id else None
    active = db.scalar(select(PluginReleaseActivation.id).where(PluginReleaseActivation.project_id == row.project_id,
                                                               PluginReleaseActivation.release_id == row.id)) is not None
    return {**{field: getattr(row, field) for field in ("id", "project_id", "plugin_id", "version", "wheel_filename",
        "wheel_sha256", "manifest", "test_cases", "status", "validation_id", "runtime_digest", "sdk_bundle_digest",
        "deployment_state", "created_at", "published_at")},
        "validation_status": validation.status if validation else None, "active": active}


@router.get("")
def list_releases(response: Response, project_id: str = Query(default=settings.default_project_id),
                  q: str = Query(default="", max_length=200), plugin_id: str | None = None,
                  status: Literal["candidate", "validating", "validated", "validation_failed", "published"] | None = None,
                  active: bool | None = None, offset: int = Query(default=0, ge=0),
                  limit: int = Query(default=200, ge=1, le=200), paginated: bool = False,
                  context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    query = select(PluginRelease).where(PluginRelease.project_id == project_id)
    if plugin_id:
        query = query.where(PluginRelease.plugin_id == plugin_id)
    if status:
        query = query.where(PluginRelease.status == status)
    if q.strip():
        query = query.where(or_(PluginRelease.plugin_id.icontains(q.strip(), autoescape=True),
                               PluginRelease.version.icontains(q.strip(), autoescape=True)))
    if active is not None:
        activation = select(PluginReleaseActivation.id).where(
            PluginReleaseActivation.project_id == project_id,
            PluginReleaseActivation.release_id == PluginRelease.id).exists()
        query = query.where(activation if active else ~activation)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = [_view(db, row) for row in db.scalars(query.order_by(
        PluginRelease.created_at.desc(), PluginRelease.id).offset(offset).limit(limit))]
    response.headers["X-Total-Count"] = str(total)
    return {"items": items, "total": total, "offset": offset, "limit": limit,
            "has_more": offset + len(items) < total} if paginated else items


@router.get("/template")
def download_template(project_id: str = Query(default=settings.default_project_id),
                      context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    path = Path(__file__).resolve().parents[3] / "examples/shot-duration-plugin/dist/shot-duration-plugin-template-v2.zip"
    if not path.is_file():
        raise HTTPException(503, "The administrator must build the SDK template before downloading it")
    return FileResponse(path, filename="shot-duration-plugin-template.zip", media_type="application/zip")


@router.post("", status_code=201)
async def upload_release(request: Request, project_id: str = Query(default=settings.default_project_id),
                         context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "develop", request)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > service.MAX_REQUEST_BYTES:
            raise HTTPException(413, "Candidate upload exceeds 12 MiB")
        body.extend(chunk)
    try:
        upload = service.CandidateUpload.model_validate_json(body)
    except ValidationError as error:
        raise HTTPException(422, [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]}
                                  for e in error.errors(include_input=False)]) from None
    try:
        row = service.save_candidate(db, upload, project_id, context.effective_user.id)
        record_audit(db, context, "operators.candidate_created", request, scope=scope,
            details={"release_id": row.id, "plugin_id": row.plugin_id, "version": row.version, "wheel_sha256": row.wheel_sha256})
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(422, str(error)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "该插件版本已存在，内容不可覆盖。请创建新版本。") from None
    return _view(db, row)


@router.get("/{release_id}")
def get_release(release_id: str, project_id: str = Query(default=settings.default_project_id),
                context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    return _view(db, _release(db, release_id, project_id))


@router.get("/{release_id}/validations")
def list_validations(release_id: str, project_id: str = Query(default=settings.default_project_id),
                     context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    _release(db, release_id, project_id)
    return [_validation_view(row) for row in db.scalars(select(PluginValidation).where(PluginValidation.release_id == release_id)
        .order_by(PluginValidation.created_at.desc()).limit(100))]


@router.post("/{release_id}/validations", status_code=202)
def validate_release(release_id: str, request: Request, project_id: str = Query(default=settings.default_project_id),
                     context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "develop", request)
    release = _release(db, release_id, project_id)
    try:
        previous = release.validation_id
        row = service.enqueue_validation(db, release, context.effective_user.id)
        if row.id != previous:
            record_audit(db, context, "operators.validation_requested", request, scope=scope,
                details={"release_id": release_id, "validation_id": row.id})
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from None
    return _validation_view(row)


@router.post("/{release_id}/publish")
def publish(release_id: str, request: Request, project_id: str = Query(default=settings.default_project_id),
            context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "publish", request)
    row = _release(db, release_id, project_id)
    try:
        already = row.status == "published"
        service.publish_release(db, row)
        if not already:
            record_audit(db, context, "operators.release_published", request, scope=scope,
                details={"release_id": row.id, "plugin_id": row.plugin_id, "version": row.version,
                         "wheel_sha256": row.wheel_sha256, "runtime_digest": row.runtime_digest,
                         "sdk_bundle_digest": row.sdk_bundle_digest})
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An operator ID and version is already owned by another published release; increment its version") from None
    return _view(db, row)


@router.post("/{release_id}/activate")
def activate(release_id: str, request: Request, project_id: str = Query(default=settings.default_project_id),
             context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "register", request)
    row = _release(db, release_id, project_id)
    try:
        service.activate_release(db, row, project_id, context.effective_user.id)
        record_audit(db, context, "operators.release_activated", request, scope=scope, details={"release_id": row.id,
            "plugin_id": row.plugin_id, "version": row.version})
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from None
    except IntegrityError:
        db.rollback()
        if not db.scalar(select(PluginReleaseActivation.id).where(PluginReleaseActivation.project_id == project_id,
                                                                 PluginReleaseActivation.release_id == row.id)):
            raise
    return _view(db, row)
