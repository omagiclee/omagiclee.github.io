"""Plugin control plane; candidate Python is executed only by the container runner.

Run the independent validation consumer with:
  python -m app.plugin_release_service worker [--once]
Expired leases are failed closed, never replayed automatically. A developer can
request another validation after inspecting the interrupted attempt.
"""
import argparse
import base64
import binascii
from copy import deepcopy
import configparser
from datetime import timedelta
from email.parser import Parser
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import time
from typing import Any, Literal
from uuid import uuid4
import zipfile

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator
from sqlalchemy import select, update

from . import database
from .models import utc_now
from .pipeline_sdk import ARTIFACT_TYPES, ID_PATTERN
from .plugin_release_models import (PluginRelease, PluginReleaseActivation,
                                    PluginValidation, PublishedPluginOperator)

MAX_WHEEL_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 12 * 1024 * 1024
MAX_EXPANDED_BYTES = 32 * 1024 * 1024
MAX_REPORT_BYTES = 2 * 1024 * 1024
LEASE_SECONDS = 600
_DIGEST = re.compile(r"^[a-f0-9]{64}$")
_IMAGE = re.compile(r"^(?:[a-zA-Z0-9._:/-]+@)?sha256:[a-f0-9]{64}$")


class OperatorDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=2, max_length=100)
    version: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9.+_-]*$")
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    kind: Literal["source", "transform", "sink"]
    input_type: str | None
    output_type: str
    config_schema: dict[str, Any]
    default_config: dict[str, Any] = Field(default_factory=dict)
    deterministic: bool = True
    side_effects: bool = False
    input_ports: dict[str, str] = Field(default_factory=dict, max_length=40)
    retry_safe: bool | None = None
    cacheable: bool | None = None

    @model_serializer(mode="wrap")
    def serialize_contract(self, handler):
        # Optional extensions must not rewrite existing published contracts or
        # the digest of a legacy manifest that never declared these fields.
        result = handler(self)
        if not self.input_ports:
            result.pop("input_ports", None)
        for name in ("retry_safe", "cacheable"):
            if getattr(self, name) is None:
                result.pop(name, None)
        return result

    @model_validator(mode="after")
    def contract(self):
        if (not ID_PATTERN.fullmatch(self.id) or self.id.startswith(("media.", "builtin.", "documents.", "object."))
                or self.id == "object_documents_source"):
            raise ValueError("Invalid operator ID or reserved platform namespace")
        if self.output_type not in ARTIFACT_TYPES or self.input_type not in {None, *ARTIFACT_TYPES}:
            raise ValueError("Unsupported artifact contract")
        if any(not ID_PATTERN.fullmatch(port) or kind not in ARTIFACT_TYPES
               for port, kind in self.input_ports.items()):
            raise ValueError("Unsupported named input port contract")
        if (self.kind == "source") != (self.input_type is None and not self.input_ports):
            raise ValueError("Only source operators have no input")
        if self.config_schema.get("type") != "object":
            raise ValueError("config_schema must describe an object")
        if len(json.dumps(self.config_schema, allow_nan=False).encode()) > 256 * 1024:
            raise ValueError("config_schema exceeds 256 KiB")
        pending = [(self.config_schema, 0)]
        while pending:
            value, depth = pending.pop()
            if depth > 64:
                raise ValueError("config_schema nesting exceeds limit")
            if isinstance(value, dict):
                for key in ("$ref", "$id", "$dynamicRef", "$recursiveRef"):
                    if key in value and (not isinstance(value[key], str) or not value[key].startswith("#")):
                        raise ValueError("Schema references must be local fragments; remote references are forbidden")
                pending.extend((item, depth + 1) for item in value.values())
            elif isinstance(value, list):
                pending.extend((item, depth + 1) for item in value)
        return self


class ManifestDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=2, max_length=100)
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    version: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9.+_-]*$")
    sdk_version: Literal["1"] = "1"
    operators: list[OperatorDeclaration] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def identities(self):
        if not ID_PATTERN.fullmatch(self.id) or self.id in {"media.video", "builtin.core", "documents.core", "object.storage"}:
            raise ValueError("Invalid plugin ID or reserved platform namespace")
        keys = [(op.id, op.version) for op in self.operators]
        if len(set(keys)) != len(keys):
            raise ValueError("Duplicate operator identity")
        return self


class ValidationCase(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str = Field(min_length=1, max_length=160)
    operator_id: str = Field(min_length=2, max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)
    input: dict[str, Any] | None
    expected: dict[str, Any] | None = None
    expected_error: dict[Literal["type"], str] | None = None

    @model_validator(mode="after")
    def one_expectation(self):
        if (self.expected is None) == (self.expected_error is None):
            raise ValueError("Provide exactly one expected artifact or expected_error")
        if self.expected_error is not None and (set(self.expected_error) != {"type"} or
                not re.fullmatch(r"[A-Za-z_]\w{0,99}", self.expected_error["type"])):
            raise ValueError("expected_error must name an exception type")
        return self


class CandidateUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    wheel_filename: str = Field(min_length=1, max_length=240)
    wheel_base64: str = Field(max_length=((MAX_WHEEL_BYTES + 2) // 3) * 4)
    manifest: ManifestDeclaration
    test_cases: list[ValidationCase] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def cases_cover_operators(self):
        declared = {op.id for op in self.manifest.operators}
        covered = {case.operator_id for case in self.test_cases}
        if covered != declared:
            raise ValueError("Each declared operator needs at least one test case; unknown operators are forbidden")
        if {c.operator_id for c in self.test_cases if c.expected is not None} != declared:
            raise ValueError("Each operator needs at least one successful artifact test case")
        if len({op.id for op in self.manifest.operators}) != len(self.manifest.operators):
            raise ValueError("One version per operator is allowed inside a release")
        json.dumps({"manifest": self.manifest.model_dump(), "test_cases": [c.model_dump() for c in self.test_cases]}, allow_nan=False)
        return self


def release_root() -> Path:
    return Path(os.environ.get("FLYWHEEL_PLUGIN_ROOT", str(Path(__file__).resolve().parents[3] / ".data/plugin-releases"))).expanduser().resolve()


def wheel_path(relative: str) -> Path:
    root = release_root()
    path = (root / relative).resolve()
    if Path(relative).is_absolute() or not path.is_relative_to(root) or path == root:
        raise ValueError("Invalid release artifact path")
    return path


def configured_runtime() -> str | None:
    value = os.environ.get("FLYWHEEL_PLUGIN_RUNTIME_IMAGE")
    if value is None:
        config_path = Path(__file__).resolve().parents[3] / ".data/plugin-runtime.json"
        try:
            if config_path.stat().st_size > 4096:
                return None
            value = json.loads(config_path.read_text()).get("image_digest", "")
        except (OSError, ValueError, AttributeError):
            return None
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if _IMAGE.fullmatch(value) else None


def check_wheel(upload: CandidateUpload) -> tuple[bytes, str]:
    """Inspect bounded ZIP metadata/content without extracting or importing it."""
    filename = upload.wheel_filename
    if not re.fullmatch(r"[A-Za-z0-9_.+!-]+-py3-none-any\.whl", filename):
        raise ValueError("Only a named py3-none-any wheel is supported")
    try:
        content = base64.b64decode(upload.wheel_base64, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Invalid wheel base64") from error
    if not 0 < len(content) <= MAX_WHEEL_BYTES:
        raise ValueError("Wheel must be nonempty and no larger than 8 MiB")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if not 1 <= len(entries) <= 2000 or sum(e.file_size for e in entries) > MAX_EXPANDED_BYTES:
                raise ValueError("Wheel exceeds archive entry or expanded-size limits")
            names, infos = set(), {}
            for entry in entries:
                name = entry.filename
                parts = PurePosixPath(name).parts
                if (not name or "\\" in name or "\x00" in name or name.startswith("/") or
                        any(p in {"..", "."} or ":" in p for p in name.split("/")) or name in names):
                    raise ValueError("Unsafe or duplicate wheel member path")
                if stat.S_IFMT(entry.external_attr >> 16) not in {0, stat.S_IFREG, stat.S_IFDIR}:
                    raise ValueError("Wheel links and special files are forbidden")
                if entry.flag_bits & 1 or entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                    raise ValueError("Unsupported wheel encryption or compression")
                if entry.file_size > max(1024 * 1024, entry.compress_size * 100):
                    raise ValueError("Wheel compression ratio exceeds limit")
                if name.lower().endswith((".so", ".dylib", ".dll", ".pyd", ".pyc", ".pth")) or any(p.endswith(".data") for p in parts):
                    raise ValueError("Only pure Python wheel files without install hooks are supported")
                names.add(name)
                infos[name] = entry
            wheel_names = [n for n in names if n.endswith(".dist-info/WHEEL")]
            if len(wheel_names) != 1:
                raise ValueError("Wheel must contain exactly one distribution")
            prefix = wheel_names[0].rsplit("/", 1)[0]
            if any(".dist-info/" in name and not name.startswith(prefix + "/") for name in names):
                raise ValueError("Wheel must not bundle additional distribution metadata")
            required = {f"{prefix}/{name}" for name in ("WHEEL", "METADATA", "RECORD", "entry_points.txt")}
            if not required <= names or any(infos[n].file_size > 256 * 1024 for n in required):
                raise ValueError("Missing or oversized wheel metadata")
            metadata = Parser().parsestr(archive.read(f"{prefix}/METADATA").decode("utf-8"))
            wheel = Parser().parsestr(archive.read(wheel_names[0]).decode("utf-8"))
            if wheel.get("Root-Is-Purelib", "").lower() != "true" or wheel.get_all("Tag") != ["py3-none-any"]:
                raise ValueError("Wheel must declare pure Python py3-none-any compatibility")
            if metadata.get("Version") != upload.manifest.version:
                raise ValueError("Wheel distribution version must match the declared plugin version")
            points = configparser.ConfigParser(interpolation=None)
            points.optionxform = str
            points.read_string(archive.read(f"{prefix}/entry_points.txt").decode("utf-8"))
            if points.sections() != ["data_flywheel.operators"] or set(points["data_flywheel.operators"]) != {upload.manifest.id}:
                raise ValueError("Wheel must expose only its declared data_flywheel.operators entry point")
            target = points["data_flywheel.operators"][upload.manifest.id]
            if not re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", target):
                raise ValueError("Unsupported plugin entry point target")
            # CRC-check every bounded member; no candidate bytecode is executed.
            if archive.testzip() is not None:
                raise ValueError("Corrupt wheel member")
    except (zipfile.BadZipFile, UnicodeError, configparser.Error, KeyError, NotImplementedError) as error:
        raise ValueError("Invalid Python wheel archive") from error
    return content, hashlib.sha256(content).hexdigest()


def save_candidate(db, upload: CandidateUpload, project_id: str, created_by: str) -> PluginRelease:
    content, digest = check_wheel(upload)
    release_id = str(uuid4())
    relative = f"{release_id}/{upload.wheel_filename}"
    path = wheel_path(relative)
    path.parent.mkdir(parents=True, exist_ok=False)
    with path.open("xb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    path.chmod(0o444)
    release = PluginRelease(id=release_id, project_id=project_id, plugin_id=upload.manifest.id,
        version=upload.manifest.version, wheel_filename=upload.wheel_filename, wheel_sha256=digest,
        wheel_path=relative, manifest=upload.manifest.model_dump(),
        test_cases=[c.model_dump(exclude_none=True) for c in upload.test_cases], created_by=created_by)
    db.add(release)
    try:
        db.flush()
    except Exception:
        path.unlink()
        path.parent.rmdir()
        raise
    return release


def enqueue_validation(db, release: PluginRelease, created_by: str) -> PluginValidation:
    if release.status == "validating" and release.validation_id:
        existing = db.get(PluginValidation, release.validation_id)
        if existing and existing.status in {"queued", "running"}:
            return existing
    validation = PluginValidation(id=str(uuid4()), release_id=release.id, wheel_sha256=release.wheel_sha256,
        runtime_digest=configured_runtime(), created_by=created_by)
    claimed = db.execute(update(PluginRelease).where(PluginRelease.id == release.id,
        PluginRelease.status.in_(["candidate", "validated", "validation_failed"])).values(
            status="validating", validation_id=validation.id, deployment_state="not_ready",
            runtime_digest=None, sdk_bundle_digest=None))
    if claimed.rowcount != 1:
        raise ValueError("Release is already validating or published")
    db.add(validation)
    db.flush()
    return validation


def _manifest_outputs(release: PluginRelease, report: dict) -> list[dict]:
    returned = report.get("operator_manifests")
    if not isinstance(returned, list) or len(returned) != len(release.manifest["operators"]):
        raise ValueError("Runner did not verify every declared operator")
    declared = {f"{o['id']}@{o['version']}": o for o in release.manifest["operators"]}
    outputs = []
    for item in returned:
        key = f"{item.get('id')}@{item.get('version')}"
        if key not in declared or not _DIGEST.fullmatch(str(item.get("implementation_digest", ""))):
            raise ValueError("Runner returned an invalid operator identity or digest")
        if any(item.get(field) != expected for field, expected in declared[key].items()):
            raise ValueError("Verified operator contract differs from the candidate declaration")
        outputs.append({**item, "key": key, "plugin_id": release.plugin_id, "plugin_version": release.version,
            "release_id": release.id, "runtime_digest": report["runtime_digest"],
            "sdk_bundle_digest": report["sdk_bundle_digest"], "wheel_sha256": release.wheel_sha256,
            "execution": "isolated-container", "trust": "validated-release"})
        del declared[key]
    return outputs


def publish_release(db, release: PluginRelease) -> PluginRelease:
    if release.status == "published":
        return release
    validation = db.get(PluginValidation, release.validation_id) if release.validation_id else None
    if (release.status != "validated" or not validation or validation.status != "passed" or
            validation.wheel_sha256 != release.wheel_sha256 or validation.runtime_digest != release.runtime_digest or
            validation.sdk_bundle_digest != release.sdk_bundle_digest or not validation.report):
        raise ValueError("The exact candidate and runtime must pass validation before publishing")
    outputs = _manifest_outputs(release, validation.report)
    changed = db.execute(update(PluginRelease).where(PluginRelease.id == release.id,
        PluginRelease.status == "validated", PluginRelease.validation_id == validation.id).values(
            status="published", published_at=utc_now()))
    if changed.rowcount != 1:
        raise ValueError("Release changed while publishing; refresh its status")
    for item in outputs:
        db.add(PublishedPluginOperator(release_id=release.id, project_id=release.project_id,
            operator_id=item["id"], version=item["version"], manifest=item))
    db.flush()
    db.refresh(release)
    return release


def activate_release(db, release: PluginRelease, project_id: str, created_by: str) -> PluginReleaseActivation:
    if release.project_id != project_id or release.status != "published" or not release.runtime_digest:
        raise ValueError("Only a published release belonging to this project can be activated")
    from .plugin_release_runner import runtime_ready
    if not runtime_ready(release.runtime_digest):
        raise ValueError("The validated runtime image is not available; deployment must be ready before activation")
    existing = db.scalar(select(PluginReleaseActivation).where(PluginReleaseActivation.project_id == project_id,
                                                             PluginReleaseActivation.release_id == release.id))
    if existing:
        return existing
    activation = PluginReleaseActivation(project_id=project_id, release_id=release.id, activated_by=created_by)
    db.add(activation)
    release.deployment_state = "ready"
    db.flush()
    return activation


def all_published_operators() -> list[dict]:
    with database.SessionLocal() as db:
        return [deepcopy(row.manifest) for row in db.scalars(select(PublishedPluginOperator).join(
            PluginRelease, PluginRelease.id == PublishedPluginOperator.release_id).where(PluginRelease.status == "published"))]


def published_operators(project_id: str, db=None) -> list[dict]:
    if db is None:
        with database.SessionLocal() as session:
            return published_operators(project_id, db=session)
    return [deepcopy(row.manifest) for row in db.scalars(select(PublishedPluginOperator).join(
            PluginRelease, PluginRelease.id == PublishedPluginOperator.release_id).join(
            PluginReleaseActivation, PluginReleaseActivation.release_id == PluginRelease.id).where(
            PluginReleaseActivation.project_id == project_id, PluginRelease.project_id == project_id,
            PluginRelease.status == "published", PluginRelease.deployment_state == "ready"))]


def resolve_release(release_id: str, project_id: str | None = None) -> dict:
    with database.SessionLocal() as db:
        release = db.get(PluginRelease, release_id)
        if not release or release.status != "published":
            raise ValueError("Published plugin release is unavailable")
        if project_id is not None and (release.project_id != project_id or not db.scalar(select(
                PluginReleaseActivation.id).where(PluginReleaseActivation.release_id == release_id,
                                                 PluginReleaseActivation.project_id == project_id))):
            raise ValueError("Plugin release is not activated in this project")
        path = wheel_path(release.wheel_path)
        if not path.is_file() or path.stat().st_size > MAX_WHEEL_BYTES or hashlib.sha256(path.read_bytes()).hexdigest() != release.wheel_sha256:
            raise ValueError("Published wheel is missing or its digest changed")
        operators = [deepcopy(row.manifest) for row in db.scalars(select(PublishedPluginOperator).where(
            PublishedPluginOperator.release_id == release.id))]
        return {"release_id": release.id, "project_id": release.project_id, "plugin_id": release.plugin_id,
            "version": release.version, "wheel_path": str(path),
            "wheel_sha256": release.wheel_sha256, "runtime_digest": release.runtime_digest,
            "sdk_bundle_digest": release.sdk_bundle_digest, "manifest": deepcopy(release.manifest),
            "operator_manifests": operators}


def expire_validation_leases() -> int:
    count = 0
    with database.SessionLocal() as db:
        for row in db.scalars(select(PluginValidation).where(PluginValidation.status == "running",
                                                           PluginValidation.lease_expires_at < utc_now())):
            changed = db.execute(update(PluginValidation).where(PluginValidation.id == row.id,
                PluginValidation.status == "running", PluginValidation.lease_token == row.lease_token,
                PluginValidation.lease_expires_at < utc_now()).values(status="blocked", finished_at=utc_now(),
                    error="Validation worker lease expired; inspect this attempt before requesting another validation")
                .execution_options(synchronize_session=False))
            if changed.rowcount:
                db.execute(update(PluginRelease).where(PluginRelease.id == row.release_id,
                    PluginRelease.validation_id == row.id, PluginRelease.status == "validating").values(status="validation_failed"))
                count += 1
        db.commit()
    return count


def run_validation_once() -> str | None:
    """Claim one durable job. No network/model work runs in the API process."""
    expire_validation_leases()
    with database.SessionLocal() as db:
        ids = list(db.scalars(select(PluginValidation.id).where(PluginValidation.status == "queued").order_by(
            PluginValidation.created_at).limit(20)))
        validation_id, lease = None, str(uuid4())
        for candidate in ids:
            changed = db.execute(update(PluginValidation).where(PluginValidation.id == candidate,
                PluginValidation.status == "queued").values(status="running", lease_token=lease,
                    started_at=utc_now(), lease_expires_at=utc_now() + timedelta(seconds=LEASE_SECONDS)))
            db.commit()
            if changed.rowcount:
                validation_id = candidate
                break
        if validation_id is None:
            return None
        validation = db.get(PluginValidation, validation_id)
        release = db.get(PluginRelease, validation.release_id)
        runtime = validation.runtime_digest
        manifest, cases, relative = deepcopy(release.manifest), deepcopy(release.test_cases), release.wheel_path
        expected_sha = validation.wheel_sha256
    report, error, outcome = None, None, "blocked"
    try:
        if not runtime:
            raise ValueError("Configure FLYWHEEL_PLUGIN_RUNTIME_IMAGE with a fixed sha256 image before validation")
        path = wheel_path(relative)
        if not path.is_file() or path.stat().st_size > MAX_WHEEL_BYTES or hashlib.sha256(path.read_bytes()).hexdigest() != expected_sha:
            raise ValueError("Candidate wheel is missing or its digest changed")
        from .plugin_release_runner import validate_release
        report = validate_release(wheel_path=str(path), manifest=manifest, test_cases=cases, runtime_digest=runtime)
        if not isinstance(report, dict) or len(json.dumps(report, allow_nan=False).encode()) > MAX_REPORT_BYTES:
            raise ValueError("Validation report is invalid or exceeds 2 MiB")
        if report.get("runtime_digest") != runtime or report.get("wheel_sha256") != expected_sha:
            raise ValueError("Validation runtime or wheel identity changed")
        if report.get("passed") is True:
            if not _DIGEST.fullmatch(str(report.get("sdk_bundle_digest", ""))):
                raise ValueError("Validation did not pin the SDK and runner bundle")
            with database.SessionLocal() as db:
                _manifest_outputs(db.get(PluginRelease, release.id), report)
            outcome = "passed"
        else:
            outcome = "failed"
            error = str(report.get("error", "Contract or sample validation failed"))[:4000]
    except Exception as failure:
        error = f"{type(failure).__name__}: {failure}"[:4000]
        # Never persist malformed or oversized reports from a broken runner.
        report = None
    with database.SessionLocal() as db:
        # A late worker cannot overwrite an expired/replaced attempt.
        sdk_digest = report.get("sdk_bundle_digest") if report else None
        changed = db.execute(update(PluginValidation).where(PluginValidation.id == validation_id,
            PluginValidation.status == "running", PluginValidation.lease_token == lease,
            PluginValidation.lease_expires_at >= utc_now()).values(status=outcome, report=report, error=error,
                sdk_bundle_digest=sdk_digest, finished_at=utc_now()))
        if changed.rowcount:
            db.execute(update(PluginRelease).where(PluginRelease.id == release.id,
                PluginRelease.validation_id == validation_id, PluginRelease.status == "validating").values(
                    status="validated" if outcome == "passed" else "validation_failed",
                    runtime_digest=runtime if outcome == "passed" else None,
                    sdk_bundle_digest=sdk_digest if outcome == "passed" else None,
                    deployment_state="ready" if outcome == "passed" else "not_ready"))
        db.commit()
    return validation_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["worker"])
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        try:
            completed = run_validation_once()
            if completed:
                print(json.dumps({"validation_id": completed, "processed": True}), flush=True)
        except Exception as error:
            print(json.dumps({"worker_error": type(error).__name__}), flush=True)
            if args.once:
                raise
        if args.once:
            return
        time.sleep(2)


if __name__ == "__main__":
    main()
