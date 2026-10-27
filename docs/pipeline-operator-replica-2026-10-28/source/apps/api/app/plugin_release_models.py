"""Immutable plugin candidates, leased validation jobs and project activation."""
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, UniqueConstraint, inspect, text
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base, new_id, utc_now


class PluginRelease(Base):
    __tablename__ = "plugin_releases"
    __table_args__ = (UniqueConstraint("project_id", "plugin_id", "version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    plugin_id: Mapped[str] = mapped_column(String(160))
    version: Mapped[str] = mapped_column(String(80))
    wheel_filename: Mapped[str] = mapped_column(String(240))
    wheel_sha256: Mapped[str] = mapped_column(String(64))
    wheel_path: Mapped[str] = mapped_column(String(400))
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON)
    test_cases: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="candidate", index=True)
    validation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    runtime_digest: Mapped[str | None] = mapped_column(String(240), nullable=True)
    sdk_bundle_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    deployment_state: Mapped[str] = mapped_column(String(24), default="not_ready")
    created_by: Mapped[str] = mapped_column(ForeignKey("app_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PluginValidation(Base):
    __tablename__ = "plugin_validations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    release_id: Mapped[str] = mapped_column(ForeignKey("plugin_releases.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    wheel_sha256: Mapped[str] = mapped_column(String(64))
    runtime_digest: Mapped[str | None] = mapped_column(String(240), nullable=True)
    sdk_bundle_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("app_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PublishedPluginOperator(Base):
    __tablename__ = "published_plugin_operators"
    __table_args__ = (UniqueConstraint("project_id", "operator_id", "version", name="uq_published_project_operator_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    release_id: Mapped[str] = mapped_column(ForeignKey("plugin_releases.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    operator_id: Mapped[str] = mapped_column(String(160))
    version: Mapped[str] = mapped_column(String(80))
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON)


def migrate_plugin_operator_namespace(engine) -> None:
    """Preserve published rows while replacing the legacy global namespace."""
    table = "published_plugin_operators"
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    if "project_id" in {column["name"] for column in inspector.get_columns(table)}:
        return
    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            connection.execute(text("""CREATE TABLE published_plugin_operators_scoped (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                release_id VARCHAR(36) NOT NULL REFERENCES plugin_releases(id),
                project_id VARCHAR(36) NOT NULL REFERENCES projects(id),
                operator_id VARCHAR(160) NOT NULL, version VARCHAR(80) NOT NULL, manifest JSON NOT NULL,
                CONSTRAINT uq_published_project_operator_version UNIQUE(project_id, operator_id, version))"""))
            connection.execute(text("""INSERT INTO published_plugin_operators_scoped
                SELECT o.id, o.release_id, r.project_id, o.operator_id, o.version, o.manifest
                FROM published_plugin_operators o JOIN plugin_releases r ON r.id = o.release_id"""))
            # Refuse migration if any orphan would otherwise silently disappear.
            before = connection.scalar(text("SELECT COUNT(*) FROM published_plugin_operators"))
            after = connection.scalar(text("SELECT COUNT(*) FROM published_plugin_operators_scoped"))
            if before != after:
                raise ValueError("Cannot migrate orphaned published plugin operators")
            connection.execute(text("DROP TABLE published_plugin_operators"))
            connection.execute(text("ALTER TABLE published_plugin_operators_scoped RENAME TO published_plugin_operators"))
            connection.execute(text("CREATE INDEX ix_published_plugin_operators_release_id ON published_plugin_operators(release_id)"))
            connection.execute(text("CREATE INDEX ix_published_plugin_operators_project_id ON published_plugin_operators(project_id)"))
        elif engine.dialect.name == "postgresql":
            connection.execute(text("ALTER TABLE published_plugin_operators ADD COLUMN project_id VARCHAR(36) REFERENCES projects(id)"))
            connection.execute(text("""UPDATE published_plugin_operators o SET project_id = r.project_id
                FROM plugin_releases r WHERE o.release_id = r.id"""))
            connection.execute(text("ALTER TABLE published_plugin_operators ALTER COLUMN project_id SET NOT NULL"))
            for constraint in inspector.get_unique_constraints(table):
                if set(constraint["column_names"]) == {"operator_id", "version"}:
                    name = engine.dialect.identifier_preparer.quote(constraint["name"])
                    connection.execute(text(f"ALTER TABLE published_plugin_operators DROP CONSTRAINT {name}"))
            connection.execute(text("ALTER TABLE published_plugin_operators ADD CONSTRAINT uq_published_project_operator_version UNIQUE(project_id, operator_id, version)"))
            connection.execute(text("CREATE INDEX ix_published_plugin_operators_project_id ON published_plugin_operators(project_id)"))
        else:
            raise ValueError("Plugin namespace migration supports SQLite and PostgreSQL")


class PluginReleaseActivation(Base):
    __tablename__ = "plugin_release_activations"
    __table_args__ = (UniqueConstraint("project_id", "release_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    release_id: Mapped[str] = mapped_column(ForeignKey("plugin_releases.id"), index=True)
    activated_by: Mapped[str] = mapped_column(ForeignKey("app_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
