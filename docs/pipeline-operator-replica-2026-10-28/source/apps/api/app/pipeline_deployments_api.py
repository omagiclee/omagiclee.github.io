"""Project-authorized deployment control and authenticated data-arrival hooks."""
from datetime import datetime
import hmac
import hashlib
import json
import os
import re
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import AuthContext, get_auth_context, record_audit
from .config import settings
from .database import get_db
from .pipeline_api import _access
from .pipeline_deployments_models import PipelineDeployment, PipelineDeploymentTrigger
from .pipeline_deployments_service import create_deployment, data_event_key, trigger_deployment

router = APIRouter(prefix="/api/pipeline-deployments", tags=["pipeline-deployments"])


class DeploymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pipeline_id: str
    pipeline_version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=160)
    environment_id: str | None = None
    worker_pool_id: str | None = None
    input_configs: dict[str, dict] = Field(default_factory=dict)
    trigger_kind: Literal["manual", "interval", "data"] = "manual"
    interval_seconds: int | None = Field(default=None, ge=60, le=31_536_000)
    timezone: str = "Asia/Shanghai"
    first_trigger_at: datetime | None = None
    use_cache: bool = True
    webhook_secret_ref: str | None = Field(default=None, pattern=r"^env:FLYWHEEL_WEBHOOK_[A-Z0-9_]+$")

    @field_validator("name")
    @classmethod
    def stripped_name(cls, value):
        if not value.strip():
            raise ValueError("Deployment name must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def valid_schedule(self):
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("Choose a valid IANA timezone") from error
        if self.trigger_kind == "interval" and not self.interval_seconds:
            raise ValueError("Interval deployment requires interval_seconds")
        if self.trigger_kind != "interval" and (self.interval_seconds or self.first_trigger_at):
            raise ValueError("Only interval deployments accept schedule fields")
        if self.first_trigger_at is not None and self.first_trigger_at.tzinfo is None:
            raise ValueError("First trigger must include a timezone offset")
        if self.trigger_kind != "data" and self.webhook_secret_ref:
            raise ValueError("Webhook secret references are only valid for data triggers")
        import json
        if len(json.dumps(self.input_configs).encode()) > 200_000:
            raise ValueError("Deployment input configuration exceeds 200 KB")
        return self


class PauseRequest(BaseModel):
    paused: bool


class TriggerRequest(BaseModel):
    event_key: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=160)


class DataEventRequest(BaseModel):
    event_key: str = Field(min_length=1, max_length=160)


class BackfillRequest(BaseModel):
    request_key: str = Field(min_length=1, max_length=80)
    partitions: list[str] = Field(min_length=1, max_length=100)

    @field_validator("partitions")
    @classmethod
    def unique_partitions(cls, values):
        if len(set(values)) != len(values) or any(not value.strip() or len(value) > 160 for value in values):
            raise ValueError("Partitions must be distinct nonempty strings of at most 160 characters")
        return values


def _deployment(db, deployment_id, project_id):
    row = db.get(PipelineDeployment, deployment_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "Deployment not found")
    return row


def _view(row):
    fields = ("id", "project_id", "pipeline_id", "pipeline_version", "name", "revision", "trigger_kind",
        "interval_seconds", "timezone", "next_trigger_at", "paused", "use_cache", "execution_snapshot", "created_at", "last_error")
    return {**{key: getattr(row, key) for key in fields}, "webhook_enabled": bool(row.webhook_secret_ref)}


@router.get("")
def list_deployments(project_id: str = Query(default=settings.default_project_id), pipeline_id: str | None = None,
                     context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    query = select(PipelineDeployment).where(PipelineDeployment.project_id == project_id)
    if pipeline_id:
        query = query.where(PipelineDeployment.pipeline_id == pipeline_id)
    return [_view(row) for row in db.scalars(query.order_by(PipelineDeployment.created_at.desc()).limit(200))]


@router.post("", status_code=201)
def create(payload: DeploymentCreate, request: Request, project_id: str = Query(default=settings.default_project_id),
           context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "write", request=request)
    # Production triggers execute with the owner's identity; creation also needs run permission.
    _access(db, context, project_id, "run")
    try:
        row = create_deployment(db, project_id, context.effective_user.id, payload)
        record_audit(db, context, "pipelines.deployment_created", request, scope=scope,
            details={"deployment_id": row.id, "revision": row.revision, "pipeline_version": row.pipeline_version})
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(422, str(error)) from error
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "Deployment revision changed concurrently; reload and retry") from error
    return _view(row)


@router.post("/{deployment_id}/state")
def set_state(deployment_id: str, payload: PauseRequest, request: Request,
              project_id: str = Query(default=settings.default_project_id),
              context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    scope = _access(db, context, project_id, "write", request=request)
    row = _deployment(db, deployment_id, project_id)
    db.execute(update(PipelineDeployment).where(PipelineDeployment.id == row.id).values(paused=payload.paused))
    record_audit(db, context, "pipelines.deployment_state_changed", request, scope=scope,
        details={"deployment_id": row.id, "paused": payload.paused})
    db.commit()
    db.refresh(row)
    return _view(row)


@router.post("/{deployment_id}/trigger", status_code=202)
def manual_trigger(deployment_id: str, payload: TriggerRequest, request: Request,
                   project_id: str = Query(default=settings.default_project_id),
                   context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, "run", request=request)
    row = _deployment(db, deployment_id, project_id)
    try:
        item = trigger_deployment(db, row, "manual:" + payload.event_key, "manual", context.effective_user.id)
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from error
    return {"run_id": item.run_id, "trigger_id": item.id}


@router.post("/{deployment_id}/backfill", status_code=202)
def backfill(deployment_id: str, payload: BackfillRequest, request: Request,
             project_id: str = Query(default=settings.default_project_id),
             context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id, "run", request=request)
    row = _deployment(db, deployment_id, project_id)
    try:
        items = [trigger_deployment(db, row, "backfill:" + hashlib.sha256(json.dumps([payload.request_key, partition]).encode()).hexdigest(),
            "backfill", context.effective_user.id, partition) for partition in payload.partitions]
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from error
    return {"runs": [{"partition": item.partition, "run_id": item.run_id} for item in items]}


@router.get("/{deployment_id}/triggers")
def trigger_history(deployment_id: str, project_id: str = Query(default=settings.default_project_id),
                    context: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    _access(db, context, project_id)
    _deployment(db, deployment_id, project_id)
    rows = db.scalars(select(PipelineDeploymentTrigger).where(PipelineDeploymentTrigger.deployment_id == deployment_id)
        .order_by(PipelineDeploymentTrigger.created_at.desc()).limit(100))
    return [{key: getattr(row, key) for key in ("id", "run_id", "source", "partition", "created_at")} for row in rows]


@router.post("/{deployment_id}/events", status_code=202)
def data_arrival(deployment_id: str, payload: DataEventRequest, authorization: str | None = Header(default=None),
                 db: Session = Depends(get_db)):
    row = db.get(PipelineDeployment, deployment_id)
    if not row or row.trigger_kind != "data" or not row.webhook_secret_ref:
        raise HTTPException(404, "Data trigger not found")
    match = re.fullmatch(r"env:(FLYWHEEL_WEBHOOK_[A-Z0-9_]+)", row.webhook_secret_ref)
    secret = os.environ.get(match.group(1), "") if match else ""
    if not secret or len(secret) < 24:
        raise HTTPException(503, "Data trigger secret is not configured on the server")
    if not authorization or not hmac.compare_digest(authorization, "Bearer " + secret):
        raise HTTPException(401, "Invalid data trigger authorization")
    try:
        item = trigger_deployment(db, row, data_event_key(payload.event_key), "data")
        db.commit()
    except ValueError as error:
        db.rollback()
        raise HTTPException(409, str(error)) from error
    return {"run_id": item.run_id, "trigger_id": item.id}
