"""Immutable production deployments and idempotent trigger history."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .models import Base, new_id, utc_now


class PipelineDeployment(Base):
    __tablename__ = "pipeline_deployments"
    __table_args__ = (UniqueConstraint("project_id", "name", "revision"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    pipeline_id: Mapped[str] = mapped_column(ForeignKey("pipelines.id"), index=True)
    pipeline_version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(160))
    revision: Mapped[int] = mapped_column(Integer)
    graph: Mapped[dict] = mapped_column(JSON)
    operator_snapshot: Mapped[list] = mapped_column(JSON)
    execution_snapshot: Mapped[dict] = mapped_column(JSON)
    trigger_kind: Mapped[str] = mapped_column(String(16))
    interval_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Shanghai")
    next_trigger_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    paused: Mapped[bool] = mapped_column(default=False)
    use_cache: Mapped[bool] = mapped_column(default=True)
    webhook_secret_ref: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("app_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class PipelineDeploymentTrigger(Base):
    __tablename__ = "pipeline_deployment_triggers"
    __table_args__ = (UniqueConstraint("deployment_id", "event_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    deployment_id: Mapped[str] = mapped_column(ForeignKey("pipeline_deployments.id"), index=True)
    event_key: Mapped[str] = mapped_column(String(240))
    source: Mapped[str] = mapped_column(String(16))
    partition: Mapped[str | None] = mapped_column(String(160), nullable=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("pipeline_runs.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
