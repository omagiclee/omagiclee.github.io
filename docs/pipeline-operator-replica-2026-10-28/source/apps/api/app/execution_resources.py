"""Immutable execution selection and SQL-serialized admission quotas.

Pools currently identify logical CPU/GPU queues for the configured Dagster
launcher. The launcher's deployment determines where image/runtime tags run.
"""
import os
import platform
import re

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from .dispatch_models import PipelineCapacityScope, PipelineResourceReservation
from .platform_models import ExecutionEnvironment, ProjectEnvironmentGrant, RuntimeRelease, WorkerPool
from .pipeline_models import PipelineRun

PINNED_IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$")


def host_architecture() -> str:
    value = platform.machine().lower()
    return {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64", "amd64": "amd64"}.get(value, value)


def validate_execution_binding(snapshot: dict, launcher: str | None = None) -> None:
    mode = launcher or os.environ.get("FLYWHEEL_EXECUTION_LAUNCHER", "default")
    if mode not in {"default", "docker"}:
        raise ValueError("FLYWHEEL_EXECUTION_LAUNCHER must be default or docker")
    if snapshot.get("profile") != "worker_pool":
        return
    image, digest = snapshot.get("runtime_image", ""), snapshot.get("runtime_digest", "")
    if not PINNED_IMAGE.fullmatch(image) or not image.endswith("@" + digest):
        raise ValueError("Runtime image must be pinned to the selected immutable sha256 digest")
    if mode == "docker":
        return
    if snapshot.get("resource_kind") == "gpu":
        raise ValueError("GPU worker pools require the Docker launcher; DefaultRunLauncher cannot bind a GPU runtime")
    if snapshot.get("cpu_arch") != host_architecture():
        raise ValueError("Selected runtime architecture differs from the local Dagster worker")
    if snapshot.get("sdk_abi") != os.environ.get("FLYWHEEL_LOCAL_SDK_ABI", "1"):
        raise ValueError("Selected runtime SDK ABI differs from the local worker")
    if digest != os.environ.get("FLYWHEEL_LOCAL_RUNTIME_DIGEST"):
        raise ValueError("DefaultRunLauncher requires FLYWHEEL_LOCAL_RUNTIME_DIGEST to identify the exact compatible local runtime; use Docker for image execution")


def freeze_execution(db, project_id: str, environment_id: str | None = None, worker_pool_id: str | None = None) -> dict:
    if not environment_id and not worker_pool_id:
        return {"profile": "local", "resource_kind": "cpu", "pool_key": "local", "cpu_arch": host_architecture(),
            "network_policy": os.environ.get("FLYWHEEL_LOCAL_NETWORK_POLICY", "approved_egress"),
            "project_key": f"project:{project_id}:local", "launcher": "configured-dagster-launcher",
            "pool_max_concurrency": max(1, int(os.environ.get("FLYWHEEL_DAGSTER_MAX_RUNS", "1"))),
            "project_max_concurrency": max(1, int(os.environ.get("FLYWHEEL_PROJECT_MAX_RUNS", "1")))}
    pool = db.get(WorkerPool, worker_pool_id) if worker_pool_id else db.scalar(select(WorkerPool).where(
        WorkerPool.environment_id == environment_id, WorkerPool.status != "disabled").order_by(WorkerPool.id).limit(1))
    if pool is None or (environment_id and pool.environment_id != environment_id):
        raise ValueError("Worker pool is absent or outside the selected environment")
    environment = db.get(ExecutionEnvironment, pool.environment_id)
    runtime = db.get(RuntimeRelease, pool.runtime_release_id)
    grant = db.scalar(select(ProjectEnvironmentGrant).where(ProjectEnvironmentGrant.project_id == project_id,
        ProjectEnvironmentGrant.environment_id == pool.environment_id, ProjectEnvironmentGrant.enabled.is_(True)))
    if not grant:
        raise ValueError("Project has no enabled grant for this execution environment")
    if not environment or not runtime or any(row.status == "disabled" for row in (pool, environment, runtime)):
        raise ValueError("Execution environment, worker pool or runtime is disabled")
    snapshot = {"profile": "worker_pool", "environment_id": environment.id,
        "environment_revision": environment.revision, "environment_stage": environment.stage,
        "network_policy": environment.network_policy, "worker_pool_id": pool.id,
        "runtime_release_id": runtime.id, "runtime_digest": runtime.digest, "runtime_image": runtime.image,
        "resource_kind": pool.resource_kind, "cpu_arch": runtime.cpu_arch, "sdk_abi": runtime.sdk_abi,
        "pool_key": f"pool:{pool.id}", "project_key": f"project:{project_id}:environment:{environment.id}",
        "pool_max_concurrency": pool.max_concurrency, "project_max_concurrency": grant.max_concurrency,
        "priority": grant.priority, "launcher": "configured-dagster-launcher"}
    validate_execution_binding(snapshot)
    return snapshot


def reserve_execution(db, run: PipelineRun, snapshot: dict) -> bool:
    """Hold both pool and project capacity until terminal state; never overbook."""
    existing = db.get(PipelineResourceReservation, run.id)
    if existing and existing.active:
        return True
    scopes = {snapshot["pool_key"]: snapshot["pool_max_concurrency"],
        snapshot["project_key"]: snapshot["project_max_concurrency"]}
    for key in sorted(scopes):
        if db.get(PipelineCapacityScope, key) is None:
            try:
                with db.begin_nested():
                    db.add(PipelineCapacityScope(key=key))
                    db.flush()
            except IntegrityError:
                pass
        # Row-level write locks serialize admissions on PostgreSQL; SQLite
        # serializes writers. Sorted locks prevent multi-pool deadlocks.
        db.execute(update(PipelineCapacityScope).where(PipelineCapacityScope.key == key).values(key=key))
    for key, maximum in scopes.items():
        attribute = PipelineResourceReservation.pool_key if key == snapshot["pool_key"] else PipelineResourceReservation.project_key
        count = db.scalar(select(func.count()).select_from(PipelineResourceReservation).join(
            PipelineRun, PipelineRun.id == PipelineResourceReservation.run_id).where(attribute == key,
                PipelineResourceReservation.active.is_(True), PipelineRun.status.in_(["pending", "running"])))
        if count >= maximum:
            return False
    if existing:
        existing.active = True
    else:
        db.add(PipelineResourceReservation(run_id=run.id, pool_key=snapshot["pool_key"], project_key=snapshot["project_key"]))
    db.flush()
    return True


def release_execution(db, run_id: str) -> None:
    db.execute(update(PipelineResourceReservation).where(PipelineResourceReservation.run_id == run_id).values(active=False))


def execution_tags(snapshot: dict) -> list[dict[str, str]]:
    fields = ("environment_id", "environment_revision", "worker_pool_id", "resource_kind", "cpu_arch", "sdk_abi", "network_policy", "runtime_digest", "runtime_image", "deployment_id", "deployment_revision", "trigger_source", "partition", "worker_id", "worker_kind", "execution_target")
    return [{"key": f"flywheel/{key}", "value": str(snapshot[key])} for key in fields if snapshot.get(key) is not None]
