"""Durable dispatch intent and fenced task execution leases."""
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base, utc_now


class PipelineDispatch(Base):
    __tablename__ = "pipeline_dispatches"
    run_id: Mapped[str] = mapped_column(ForeignKey("pipeline_runs.id"), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    execution_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class PipelineTaskAttempt(Base):
    """One execution key per immutable run node; counter tracks safe retries."""
    __tablename__ = "pipeline_task_attempts"
    task_id: Mapped[str] = mapped_column(ForeignKey("pipeline_task_runs.id"), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("pipeline_runs.id"), index=True)
    execution_key: Mapped[str] = mapped_column(String(64), unique=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="running")
    lease_token: Mapped[str] = mapped_column(String(36))
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    lease_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    artifact_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class PipelineCatalogRefresh(Base):
    __tablename__ = "pipeline_catalog_refreshes"
    location: Mapped[str] = mapped_column(String(160), primary_key=True)
    fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PipelineCapacityScope(Base):
    __tablename__ = "pipeline_capacity_scopes"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)


class PipelineResourceReservation(Base):
    __tablename__ = "pipeline_resource_reservations"
    run_id: Mapped[str] = mapped_column(ForeignKey("pipeline_runs.id"), primary_key=True)
    pool_key: Mapped[str] = mapped_column(String(200), index=True)
    project_key: Mapped[str] = mapped_column(String(200), index=True)
    active: Mapped[bool] = mapped_column(default=True)
    allocated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
