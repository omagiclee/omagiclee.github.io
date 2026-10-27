"""Append-only evidence linking candidate datasets to verified pipeline output."""
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column
from .models import Base, new_id, utc_now


class PipelineDatasetImport(Base):
    __tablename__ = 'pipeline_dataset_imports'
    __table_args__ = (UniqueConstraint('project_id', 'request_identity'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey('data_datasets.id'), unique=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey('pipeline_artifacts.id'), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey('pipeline_runs.id'))
    request_identity: Mapped[str] = mapped_column(String(80))
    request_hash: Mapped[str] = mapped_column(String(64))
    content_hash: Mapped[str] = mapped_column(String(64))
    mapping_version: Mapped[str] = mapped_column(String(80))
    mapping_digest: Mapped[str] = mapped_column(String(64))
    imported_by: Mapped[str] = mapped_column(ForeignKey('app_users.id'))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), default=utc_now)


class PipelineDatasetSample(Base):
    __tablename__ = 'pipeline_dataset_samples'
    __table_args__ = (UniqueConstraint('import_id', 'source_id'),)
    sample_id: Mapped[str] = mapped_column(ForeignKey('data_samples.id'), primary_key=True)
    import_id: Mapped[str] = mapped_column(ForeignKey('pipeline_dataset_imports.id'), index=True)
    source_id: Mapped[str] = mapped_column(String(160))
    record_hash: Mapped[str] = mapped_column(String(64))
    input_hash: Mapped[str] = mapped_column(String(64))


def _immutable(mapper, connection, target):
    raise ValueError('Pipeline dataset import evidence is immutable')


for _model in (PipelineDatasetImport, PipelineDatasetSample):
    event.listen(_model, 'before_update', _immutable)
    event.listen(_model, 'before_delete', _immutable)
