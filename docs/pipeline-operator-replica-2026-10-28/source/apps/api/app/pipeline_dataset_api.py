"""Project-authorized promotion of formal pipeline outputs to candidate datasets."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import AuthContext, get_auth_context, record_audit
from .config import settings
from .database import get_db
from .pipeline_api import PipelineRoute, _access
from . import pipeline_dataset_service as service

router = APIRouter(prefix='/api', tags=['pipeline-datasets'], route_class=PipelineRoute)


class CandidateCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: StrictStr = Field(min_length=1, max_length=160)
    idempotency_key: UUID | None = None

    @field_validator('name')
    @classmethod
    def visible_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('候选数据集名称不能为空')
        return value


@router.post('/pipeline-artifacts/{artifact_id}/dataset', status_code=201)
def create_candidate(artifact_id: str, payload: CandidateCreate, request: Request,
                     project_id: str = Query(default=settings.default_project_id),
                     context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, 'read', 'pipelines')
    _access(db, context, project_id, 'read', 'data_platform')
    scope = _access(db, context, project_id, 'write', 'data_platform', request=request)
    artifact = service.source_artifact(db, artifact_id, project_id)
    request_identity, request_hash = service.identity(artifact, payload.name, payload.idempotency_key)
    imported = service.existing(db, project_id, request_identity, request_hash)
    if imported:
        return service.result(db, imported, False)
    try:
        imported = service.create_candidate(db, artifact, payload.name, request_identity, request_hash, context.effective_user.id)
        response = service.result(db, imported, True)
        record_audit(db, context, 'data_platform.pipeline_artifact.imported', request, scope=scope,
                     details={'dataset_id': imported.dataset_id, **service.source(imported)})
        db.commit()
        return response
    except IntegrityError:
        db.rollback()
        imported = service.existing(db, project_id, request_identity, request_hash)
        if imported:
            return service.result(db, imported, False)
        raise HTTPException(422, '产物包含重复来源ID或导入记录冲突，未创建数据集') from None
    except Exception:
        db.rollback()
        raise
