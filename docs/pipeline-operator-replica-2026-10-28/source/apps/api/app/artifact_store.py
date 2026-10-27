"""Shard large immutable record manifests, and verify referenced file content."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Iterator

from .object_storage import ObjectStore

INLINE_RECORDS = 500
SHARD_BYTES = 4 * 1024 * 1024
MAX_ARTIFACT_SHARDS = 10_000
MAX_ARTIFACT_RECORDS = 1_000_000


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def _file_references(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str) and (key == "path" or key.endswith("_path")) and item:
                yield item
            else:
                yield from _file_references(item)
    elif isinstance(value, list):
        for item in value:
            yield from _file_references(item)


def file_manifest(payload, project_id: str, *, archive: bool = False) -> list[dict]:
    from .media_store import media_path
    result = []
    for reference in sorted(set(_file_references(payload))):
        try:
            path = media_path(reference, project_id, must_exist=True)
        except (ValueError, FileNotFoundError):
            # Only media filesystem references are supported here. Unknown paths
            # are retained as invalid, so they can never become a cache hit.
            result.append({"path": reference, "missing": True})
            continue
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while block := source.read(1024 * 1024):
                digest.update(block)
        item = {"path": reference, "size": path.stat().st_size, "sha256": digest.hexdigest()}
        if archive and ObjectStore(project_id).backend == "s3":
            item["uri"] = ObjectStore(project_id).upload_file("media/" + item["sha256"], path)
        result.append(item)
    return result


def persist_payload(payload: dict, project_id: str) -> dict:
    stored = deepcopy(payload)
    records = stored["records"]
    if len(records) > MAX_ARTIFACT_RECORDS:
        raise ValueError("Artifact exceeds the one-million-record bound; partition the input")
    stored["file_manifest"] = file_manifest(payload, project_id, archive=True)
    if len(records) <= INLINE_RECORDS and len(canonical(stored)) <= SHARD_BYTES:
        return stored
    store = ObjectStore(project_id)
    shards, lines, size = [], [], 0

    def flush():
        nonlocal lines, size
        if not lines:
            return
        content = b"\n".join(lines) + b"\n"
        digest = hashlib.sha256(content).hexdigest()
        uri = store.put("artifacts/" + digest + ".jsonl", content)
        shards.append({"uri": uri, "sha256": digest, "record_count": len(lines), "size": len(content)})
        lines, size = [], 0

    for record in records:
        encoded = canonical(record)
        if len(encoded) + 1 > SHARD_BYTES:
            raise ValueError("A single record exceeds 4 MiB")
        if size + len(encoded) + 1 > SHARD_BYTES:
            flush()
        lines.append(encoded)
        size += len(encoded) + 1
        if len(lines) >= 1000:
            flush()
    flush()
    manifest = {"schema": "flywheel.artifact.v2", "record_count": len(records), "shards": shards}
    stored["records"] = []
    stored["manifest"] = {**manifest, "sha256": hashlib.sha256(canonical(manifest)).hexdigest()}
    return stored


def iter_records(stored: dict, project_id: str) -> Iterator[dict]:
    if "manifest" not in stored:
        yield from stored.get("records", [])
        return
    manifest = stored["manifest"]
    if not isinstance(manifest.get("shards"),list) or len(manifest["shards"]) > MAX_ARTIFACT_SHARDS:
        raise ValueError("Artifact shard descriptor limit exceeded; partition the artifact")
    if manifest.get("schema") != "flywheel.artifact.v2":
        raise ValueError("Unsupported artifact manifest")
    body = {key: value for key, value in manifest.items() if key != "sha256"}
    if hashlib.sha256(canonical(body)).hexdigest() != manifest.get("sha256"):
        raise ValueError("Artifact manifest checksum mismatch")
    count = 0
    store = ObjectStore(project_id)
    for shard in manifest["shards"]:
        data = store.get(shard["uri"], maximum=SHARD_BYTES)
        if len(data) != shard["size"] or hashlib.sha256(data).hexdigest() != shard["sha256"]:
            raise ValueError("Artifact shard checksum mismatch")
        rows = data.splitlines()
        if len(rows) != shard["record_count"]:
            raise ValueError("Artifact shard record count mismatch")
        for line in rows:
            count += 1
            if count > MAX_ARTIFACT_RECORDS:
                raise ValueError("Artifact record limit exceeded")
            yield json.loads(line)
    if count != manifest["record_count"]:
        raise ValueError("Artifact record count mismatch")


def hydrate_files(stored: dict, project_id: str) -> None:
    # Verify every immutable media reference before exposing it to an operator.
    from .media_store import media_path
    from uuid import uuid4
    for item in stored.get("file_manifest", []):
        if item.get("missing"):
            raise ValueError("Artifact references a missing media file")
        path = media_path(item["path"], project_id)
        candidate = path
        temporary = None
        if not path.is_file() and item.get("uri"):
            temporary = path.with_name(path.name + ".hydrate-" + str(uuid4()))
            ObjectStore(project_id).download_file(item["uri"], temporary)
            candidate = temporary
        try:
            digest = hashlib.sha256()
            with candidate.open("rb") as source:
                while block := source.read(1024 * 1024):
                    digest.update(block)
            if candidate.stat().st_size != item["size"] or digest.hexdigest() != item["sha256"]:
                raise ValueError("Media file checksum mismatch")
            if temporary:
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary.replace(path)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
def load_payload(stored: dict, project_id: str) -> dict:
    hydrate_files(stored, project_id)
    result = deepcopy(stored)
    result["records"] = list(iter_records(stored, project_id))
    result.pop("manifest", None)
    result.pop("file_manifest", None)
    return result


def validate_payload_files(stored: dict, project_id: str) -> bool:
    try:
        payload = load_payload(stored, project_id)
        # Legacy unverified references are deliberately ineligible for caching.
        recorded = stored.get("file_manifest")
        actual = file_manifest(payload, project_id)
        return not any(item.get("missing") for item in actual) and (
            actual == [{k:v for k,v in item.items() if k != "uri"} for item in recorded] if recorded is not None else not actual)
    except (ValueError, OSError, KeyError, TypeError):
        return False


def verify_payload(stored: dict, project_id: str, expected_hash: str) -> dict:
    payload = load_payload(stored, project_id)
    if hashlib.sha256(canonical(payload)).hexdigest() != expected_hash:
        raise ValueError("Artifact payload checksum mismatch")
    return payload


def stream_content_hash(stored: dict, project_id: str) -> str:
    """Hash the canonical hydrated artifact without materializing its records."""
    digest = hashlib.sha256()
    digest.update(b'{')
    fields = sorted(set(stored) - {'manifest', 'file_manifest'} | {'records'})
    for index, field in enumerate(fields):
        if index:
            digest.update(b',')
        digest.update(canonical(field) + b':')
        if field != 'records':
            digest.update(canonical(stored[field]))
            continue
        digest.update(b'[')
        for position, record in enumerate(iter_records(stored, project_id)):
            if position:
                digest.update(b',')
            digest.update(canonical(record))
        digest.update(b']')
    digest.update(b'}')
    return digest.hexdigest()


def verify_stream(stored: dict, project_id: str, expected_hash: str) -> None:
    hydrate_files(stored, project_id)
    if stream_content_hash(stored, project_id) != expected_hash:
        raise ValueError('Artifact payload checksum mismatch')
    references = set(_file_references({k: v for k, v in stored.items() if k not in {'records', 'manifest', 'file_manifest'}}))
    for record in iter_records(stored, project_id):
        references.update(_file_references(record))
        if len(references) > 10_000:
            raise ValueError('Too many file references; partition the artifact')
    recorded = {item['path'] for item in stored.get('file_manifest', []) if not item.get('missing')}
    if references != recorded:
        raise ValueError('Referenced files lack a valid content manifest')


class BoundedArtifactWriter:
    """Backpressured JSONL writer; at most 4MiB of record bytes are buffered.

    Record identities use a temporary SQLite unique index rather than an
    unbounded Python set. Manifest descriptors are bounded by the artifact's
    existing one-million-record / ten-thousand-file limits.
    """
    def __init__(self, project_id: str, artifact_type: str):
        import sqlite3
        import tempfile
        self.project_id, self.artifact_type = project_id, artifact_type
        self.store = ObjectStore(project_id)
        self.temporary = tempfile.TemporaryDirectory(prefix='flywheel-record-ids-')
        self.ids = sqlite3.connect(str(Path(self.temporary.name) / 'ids.db'))
        self.ids.execute('CREATE TABLE ids (id TEXT PRIMARY KEY)')
        self.lines, self.size, self.count, self.shards, self.files = [], 0, 0, [], {}
        self.base = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.ids.close()
        self.temporary.cleanup()

    def flush(self):
        if not self.lines:
            return
        if len(self.shards) >= MAX_ARTIFACT_SHARDS:
            raise ValueError("Artifact shard descriptor limit exceeded; partition the artifact")
        content = b'\n'.join(self.lines) + b'\n'
        digest = hashlib.sha256(content).hexdigest()
        self.shards.append({'uri': self.store.put('artifacts/' + digest + '.jsonl', content),
            'sha256': digest, 'record_count': len(self.lines), 'size': len(content)})
        self.lines, self.size = [], 0

    def append(self, payload: dict):
        import sqlite3
        if payload['type'] != self.artifact_type:
            raise ValueError('Batch output artifact type differs from its contract')
        base = {key: value for key, value in payload.items() if key != 'records'}
        if len(canonical(base)) > 256 * 1024:
            raise ValueError('Batch metadata exceeds 256KiB')
        if self.base is None:
            self.base = deepcopy(base)
        elif canonical(self.base) != canonical(base):
            raise ValueError('Batch metadata must remain stable across partitions')
        for item in file_manifest(payload, self.project_id, archive=True):
            self.files[item['path']] = item
            if len(self.files) > 10_000:
                raise ValueError('Too many output file references; partition the artifact')
        for record in payload['records']:
            encoded = canonical(record)
            if len(encoded) + 1 > SHARD_BYTES:
                raise ValueError('A single record exceeds 4MiB')
            try:
                self.ids.execute('INSERT INTO ids VALUES (?)', (record['id'],))
            except sqlite3.IntegrityError as error:
                raise ValueError('Duplicate artifact record identity across partitions') from error
            self.count += 1
            if self.count > MAX_ARTIFACT_RECORDS:
                raise ValueError('Artifact exceeds the one-million-record bound')
            if self.size + len(encoded) + 1 > SHARD_BYTES:
                self.flush()
            self.lines.append(encoded)
            self.size += len(encoded) + 1
            if len(self.lines) >= 1000:
                self.flush()

    def finish(self) -> tuple[dict, str]:
        self.flush()
        body = {'schema': 'flywheel.artifact.v2', 'record_count': self.count, 'shards': self.shards}
        stored = {**(self.base or {'type': self.artifact_type, 'metadata': {}}), 'records': [],
            'file_manifest': [self.files[key] for key in sorted(self.files)],
            'manifest': {**body, 'sha256': hashlib.sha256(canonical(body)).hexdigest()}}
        return stored, stream_content_hash(stored, self.project_id)
