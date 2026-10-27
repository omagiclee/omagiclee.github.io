"""Project-scoped media catalog; large media and vectors stay on disk."""

from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, synonym

from .models import Base, utc_now


class VideoAsset(Base):
    __tablename__ = "media_videos"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    source_url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String(500))
    duration_ms: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    path: Mapped[str] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class ShotAsset(Base):
    __tablename__ = "media_shots"
    __table_args__ = (UniqueConstraint("project_id", "video_id", "segmenter_revision", "index"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    video_id: Mapped[str] = mapped_column(ForeignKey("media_videos.id"), index=True)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    index: Mapped[int] = mapped_column(Integer)
    segmenter_revision: Mapped[str] = mapped_column(String(200))
    person_status: Mapped[str] = mapped_column(String(24), default="unknown", index=True)
    index_state: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    frame_count: Mapped[int] = mapped_column(Integer, default=0)
    embedding_model: Mapped[str | None] = mapped_column(String(300), nullable=True)
    collection: Mapped[str | None] = mapped_column(Text, nullable=True)
    index_collection = synonym("collection")
    embedding_spaces: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    video_vector_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    index_run_id: Mapped[str | None] = mapped_column(ForeignKey("pipeline_runs.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class Keyframe(Base):
    __tablename__ = "media_keyframes"
    __table_args__ = (UniqueConstraint("project_id", "shot_id", "timestamp_ms"),)

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    shot_id: Mapped[str] = mapped_column(ForeignKey("media_shots.id"), index=True)
    timestamp_ms: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(Text)
    mask_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    detections: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    model_revision: Mapped[str | None] = mapped_column(String(300), nullable=True)
    vector_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class DagsterExecution(Base):
    __tablename__ = "dagster_executions"

    run_id: Mapped[str] = mapped_column(ForeignKey("pipeline_runs.id"), primary_key=True)
    dagster_run_id: Mapped[str | None] = mapped_column(String(36), unique=True, nullable=True)
    job_name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(40), default="SUBMITTING")
    submission_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class MediaIndexPublication(Base):
    __tablename__ = "media_index_publications"

    run_id: Mapped[str] = mapped_column(ForeignKey("pipeline_runs.id"), primary_key=True)
    shot_id: Mapped[str] = mapped_column(ForeignKey("media_shots.id"), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="staged", index=True)
    embedding_model: Mapped[str] = mapped_column(String(300))
    collection: Mapped[str] = mapped_column(Text)
    embedding_spaces: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utc_now)


class MediaProcessingSnapshot(Base):
    __tablename__ = "media_processing_snapshots"

    run_id: Mapped[str] = mapped_column(ForeignKey("pipeline_runs.id"), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    signature: Mapped[str] = mapped_column(String(64))
    model_manifest_digest: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utc_now)
