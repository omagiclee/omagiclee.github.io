"""Transactional outbox consumer. Run independently of HTTP workers.

    python -m app.dispatch_worker [--once]

A transport-uncertain submission is reconciled by identity and never blindly
resent. Leases protect against duplicate dispatchers; SQL CAS fences late writes.
"""
import argparse
from datetime import timedelta
import logging
import time
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError

from . import database, media_jobs
from .dispatch_models import PipelineDispatch
from .execution_resources import freeze_execution, release_execution, reserve_execution, validate_execution_binding
from .media_models import DagsterExecution
from .models import utc_now
from .pipeline_models import PipelineRun, PipelineRunSubmission

LEASE_SECONDS = 120
MAX_ATTEMPTS = 8


def enqueue_run(db, run: PipelineRun, use_cache: bool = True, execution_snapshot: dict | None = None) -> PipelineDispatch:
    """Enqueue in the caller's run-creation transaction; never commit here."""
    existing = db.get(PipelineDispatch, run.id)
    if existing:
        return existing
    item = PipelineDispatch(run_id=run.id, project_id=run.project_id,
        options={"use_cache": use_cache}, execution_snapshot=execution_snapshot or freeze_execution(db, run.project_id))
    db.add(item)
    db.flush()
    return item


def requeue_run(db, run: PipelineRun, use_cache: bool | None = None) -> PipelineDispatch:
    """Explicit retry of the same durable intent; unknown submissions stay fenced."""
    if run.status != "pending":
        raise ValueError("Only pending runs can retry submission")
    intent = db.get(PipelineDispatch, run.id)
    if intent is None:
        return enqueue_run(db, run, True if use_cache is None else use_cache)
    if intent.status == "dispatching":
        raise ValueError("Submission is leased to an active dispatcher")
    execution = db.get(DagsterExecution, run.id)
    if execution and execution.dagster_run_id:
        return intent
    if use_cache is not None and use_cache != intent.options.get("use_cache", True):
        raise ValueError("Retry must preserve the original cache policy")
    intent.status = "unknown" if execution and execution.status == "SUBMISSION_UNKNOWN" else "queued"
    intent.available_at, intent.last_error = utc_now(), None
    intent.lease_token, intent.lease_expires_at, intent.attempts = None, None, 0
    db.flush()
    return intent


def _claim() -> tuple[str, str] | None:
    now = utc_now()
    eligible = or_(PipelineDispatch.status.in_(["queued", "retry", "unknown"]),
        (PipelineDispatch.status == "dispatching") & (PipelineDispatch.lease_expires_at < now))
    with database.SessionLocal() as db:
        candidates = list(db.scalars(select(PipelineDispatch.run_id).where(
            eligible, PipelineDispatch.available_at <= now).order_by(PipelineDispatch.created_at).limit(20)))
        for run_id in candidates:
            token = str(uuid4())
            changed = db.execute(update(PipelineDispatch).where(PipelineDispatch.run_id == run_id,
                eligible, PipelineDispatch.available_at <= now).values(status="dispatching", lease_token=token,
                    lease_expires_at=now + timedelta(seconds=LEASE_SECONDS), attempts=PipelineDispatch.attempts + 1))
            db.commit()
            if changed.rowcount == 1:
                return run_id, token
    return None


def dispatch_once() -> str | None:
    claim = _claim()
    if not claim:
        return None
    run_id, token = claim
    with database.SessionLocal() as db:
        intent, run = db.get(PipelineDispatch, run_id), db.get(PipelineRun, run_id)
        if run is None or run.status not in {"pending", "running"}:
            outcome, error = "cancelled", None
            release_execution(db, run_id)
        else:
            outcome, error = "dispatched", None
            try:
                snapshot = {**freeze_execution(db, run.project_id), **intent.execution_snapshot}
                execution = db.get(DagsterExecution, run_id)
                # Lookup of a possibly accepted launch remains available even
                # if the launcher's configuration changed after submission.
                reconciles_existing = run.status == "running" or (execution and (
                    execution.dagster_run_id or execution.status == "SUBMISSION_UNKNOWN"))
                if not reconciles_existing:
                    validate_execution_binding(snapshot)
                    from .worker_registry import bind_worker
                    bound = bind_worker(db, run, snapshot)
                    if bound is None:
                        db.execute(update(PipelineDispatch).where(PipelineDispatch.run_id == run_id,
                            PipelineDispatch.lease_token == token).values(status="queued", lease_token=None,
                                lease_expires_at=None, attempts=PipelineDispatch.attempts - 1,
                                available_at=utc_now() + timedelta(seconds=5), last_error="Waiting for a healthy compatible execution worker"))
                        db.commit()
                        return run_id
                    snapshot = bound
                    intent.execution_snapshot = snapshot
                if not reserve_execution(db, run, snapshot):
                    db.execute(update(PipelineDispatch).where(PipelineDispatch.run_id == run_id,
                        PipelineDispatch.lease_token == token).values(status="queued", lease_token=None,
                            lease_expires_at=None, attempts=PipelineDispatch.attempts - 1,
                            available_at=utc_now() + timedelta(seconds=5), last_error="Waiting for project or worker pool capacity"))
                    db.commit()
                    return run_id
                db.commit()
                if run.status == "running" or (execution and execution.dagster_run_id):
                    media_jobs.reconcile_run(db, run)
                else:
                    media_jobs.launch(run_id, intent.options.get("use_cache", True))
            except Exception as failure:
                db.expire_all()
                execution = db.get(DagsterExecution, run_id)
                error = str(failure)[:2000] or type(failure).__name__
                if execution and execution.status in {"SUBMISSION_UNKNOWN", "CANCEL_REQUESTED"}:
                    outcome = "unknown"
                else:
                    outcome = "retry" if intent.attempts < MAX_ATTEMPTS else "failed"
                    release_execution(db, run_id)
            delay = 30 if outcome == "unknown" else min(300, 2 ** min(intent.attempts, 8))
        values = {"status": outcome, "last_error": error, "lease_token": None,
            "lease_expires_at": None, "available_at": utc_now() + timedelta(seconds=delay if error else 0)}
        db.execute(update(PipelineDispatch).where(PipelineDispatch.run_id == run_id,
            PipelineDispatch.lease_token == token).values(**values))
        db.commit()
    return run_id


def recover_pending_intents(limit: int = 50) -> int:
    """Backfill pre-outbox pending runs without changing submission identity."""
    recovered = 0
    with database.SessionLocal() as db:
        runs = list(db.scalars(select(PipelineRun).join(DagsterExecution,
            DagsterExecution.run_id == PipelineRun.id).outerjoin(PipelineDispatch,
            PipelineDispatch.run_id == PipelineRun.id).where(PipelineRun.status == "pending",
                PipelineDispatch.run_id.is_(None)).order_by(PipelineRun.created_at).limit(limit)))
        for run in runs:
            submission = db.scalar(select(PipelineRunSubmission).where(PipelineRunSubmission.run_id == run.id))
            options = submission.request_options if submission and submission.request_options else {}
            try:
                enqueue_run(db, run, options.get("use_cache", True))
                db.commit()
                recovered += 1
            except IntegrityError:
                db.rollback()  # Another consumer backfilled the same run.
    return recovered


def reconcile_dispatched(limit: int = 50) -> int:
    """Project terminal outcomes independently of browser polling."""
    with database.SessionLocal() as db:
        runs = list(db.scalars(select(PipelineRun).join(DagsterExecution,
            DagsterExecution.run_id == PipelineRun.id).where(PipelineRun.status.in_(["pending", "running"]),
                DagsterExecution.dagster_run_id.is_not(None)).order_by(PipelineRun.created_at).limit(limit)))
        for run in runs:
            media_jobs.reconcile_run(db, run)
        return len(runs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        try:
            recover_pending_intents()
            dispatched = dispatch_once()
            reconcile_dispatched()
            media_jobs.reconcile_cancelled_runs()
        except Exception:
            logging.exception("Dispatch iteration failed; durable intents remain recoverable")
            dispatched = None
        if args.once:
            return
        if dispatched is None:
            time.sleep(2)


if __name__ == "__main__":
    main()
