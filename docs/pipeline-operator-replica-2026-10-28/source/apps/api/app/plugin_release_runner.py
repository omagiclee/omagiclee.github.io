"""Fixed-image Docker adapter shared by validation workers and Dagster steps.

The API never imports uploaded wheels. Every execution receives only JSON plus
read-only wheel/SDK mounts, no app environment, Docker socket, or project files.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import tempfile
from time import monotonic
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
MAX_BYTES = 18 * 1024 * 1024
MAX_STDERR_BYTES = 64 * 1024
DIGEST = re.compile(r"^(?:[A-Za-z0-9][A-Za-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$")


def _docker(*args, timeout=10):
    return subprocess.run(["docker", *args], capture_output=True, timeout=timeout, check=False)


def runtime_ready(runtime_digest: str) -> bool:
    if not DIGEST.fullmatch(runtime_digest):
        return False
    try:
        result = _docker("image", "inspect", runtime_digest, "--format", "{{.Id}}")
        return result.returncode == 0 and bool(re.fullmatch(r"sha256:[a-f0-9]{64}", result.stdout.decode().strip()))
    except (OSError, subprocess.TimeoutExpired):
        return False


def _bundle_root():
    return Path(os.environ.get("FLYWHEEL_PLUGIN_BUNDLE_ROOT", str(ROOT / ".data/plugin-runtime-bundles"))).resolve()


def prepare_bundle() -> str:
    files = {"runner.py": (ROOT / "infra/plugin-runtime/runner.py").read_bytes(),
             "flywheel_sdk/__init__.py": (ROOT / "packages/flywheel-sdk/src/flywheel_sdk/__init__.py").read_bytes()}
    digest = hashlib.sha256(b"".join(name.encode() + b"\0" + value for name, value in sorted(files.items()))).hexdigest()
    destination = _bundle_root() / digest
    for name, value in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(value)
            path.chmod(0o444)
        elif path.read_bytes() != value:
            raise ValueError("Immutable SDK bundle has changed")
    return digest


def _verified_bundle(digest):
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Invalid SDK bundle digest")
    path = _bundle_root() / digest
    names = ["flywheel_sdk/__init__.py", "runner.py"]
    actual = hashlib.sha256(b"".join(name.encode() + b"\0" + (path / name).read_bytes() for name in names)).hexdigest()
    if actual != digest:
        raise ValueError("SDK bundle content mismatch")
    return path


def _invoke(*, wheel_path, wheel_sha256, runtime_digest, sdk_bundle_digest, request, timeout=90):
    if not runtime_ready(runtime_digest):
        raise ValueError("Configured plugin runtime image is not available on this executor")
    wheel = Path(wheel_path).resolve(strict=True)
    if hashlib.sha256(wheel.read_bytes()).hexdigest() != wheel_sha256:
        raise ValueError("Plugin wheel content mismatch")
    bundle = _verified_bundle(sdk_bundle_digest)
    payload = json.dumps(request, allow_nan=False).encode()
    if len(payload) > MAX_BYTES:
        raise ValueError("Plugin input exceeds the bounded protocol")
    name = f"flywheel-plugin-{uuid4().hex}"
    command = ["docker", "run", "--rm", "--name", name, "--pull", "never", "--network", "none",
               "--log-driver", "none",
               "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--user", "65534:65534", "--cpus", "1", "--memory", "512m", "--pids-limit", "64",
               "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--workdir", "/tmp",
               "--mount", f"type=bind,source={wheel},target=/plugin.whl,readonly",
               "--mount", f"type=bind,source={bundle},target=/runtime,readonly",
               "-i", "--entrypoint", "python", runtime_digest, "-I", "/runtime/runner.py"]
    # Only the already-bounded input touches disk. A pipe for stdin can deadlock
    # if a candidate fills stdout before reading its request, so provide a file.
    with tempfile.TemporaryFile() as input_file:
        input_file.write(payload)
        input_file.seek(0)
        output, errors = bytearray(), bytearray()
        process = None
        deadline = monotonic() + timeout
        try:
            process = subprocess.Popen(command, stdin=input_file, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, bufsize=0)
            with selectors.DefaultSelector() as selector:
                for stream, destination, maximum, label in ((process.stdout, output, MAX_BYTES, "output"),
                                                            (process.stderr, errors, MAX_STDERR_BYTES, "stderr")):
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ, (destination, maximum, label))
                while selector.get_map():
                    remaining = deadline - monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(command, timeout)
                    for key, _ in selector.select(min(remaining, 0.25)):
                        destination, maximum, label = key.data
                        # Read at most one byte beyond the cap, then stop the
                        # container immediately without storing the excess.
                        try:
                            chunk = os.read(key.fd, min(64 * 1024, maximum - len(destination) + 1))
                        except BlockingIOError:
                            continue
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                        elif len(destination) + len(chunk) > maximum:
                            raise ValueError(f"Plugin {label} exceeds the bounded protocol")
                        else:
                            destination.extend(chunk)
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, timeout)
            process.wait(timeout=remaining)
            if process.returncode:
                raise ValueError("Plugin container failed: " + errors[:3000].decode(errors="replace"))
            try:
                response = json.loads(output)
            except (ValueError, UnicodeError):
                raise ValueError("Plugin container returned invalid JSON") from None
            if not isinstance(response, dict):
                raise ValueError("Plugin container returned invalid response")
        except BaseException:
            # Stop the local reader immediately; killing only the Docker client
            # does not stop its container. Preserve the original failure even
            # when the Docker daemon is unavailable during cleanup.
            if process is not None:
                try:
                    process.kill()
                except OSError:
                    pass
            try:
                _docker("rm", "-f", name)
            except Exception:
                pass
            if process is not None:
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:
                        process.kill()
                        process.wait(timeout=2)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
            raise
        finally:
            if process is not None:
                for stream in (process.stdout, process.stderr):
                    if stream is not None and not stream.closed:
                        stream.close()
    return response


def validate_release(*, wheel_path: str, manifest: dict, test_cases: list, runtime_digest: str) -> dict:
    bundle = prepare_bundle()
    wheel_sha = hashlib.sha256(Path(wheel_path).read_bytes()).hexdigest()
    report = _invoke(wheel_path=wheel_path, wheel_sha256=wheel_sha, runtime_digest=runtime_digest,
                     sdk_bundle_digest=bundle, request={"mode": "validate", "plugin_id": manifest["id"],
                        "manifest": manifest, "test_cases": test_cases})
    report.update(runtime_digest=runtime_digest, sdk_bundle_digest=bundle, wheel_sha256=wheel_sha)
    for item in report.get("operator_manifests", []):
        contract = {key: value for key, value in item.items() if key != "implementation_digest"}
        item["implementation_digest"] = hashlib.sha256(json.dumps({"wheel": wheel_sha, "runtime": runtime_digest,
            "sdk": bundle, "contract": contract}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        item.update(runtime_digest=runtime_digest, sdk_bundle_digest=bundle, execution="isolated-container")
    if not report.get("ok"):
        report["passed"] = False
    # Host validation also enforces vector dimensions and the platform artifact protocol.
    from .pipeline_runtime import validate_artifact
    for check in report.get("checks", []):
        if "output" in check:
            try:
                op = next(item for item in manifest["operators"] if item["id"] == check["operator_id"])
                validate_artifact(check["output"], op["output_type"])
            except (ValueError, TypeError, StopIteration) as error:
                check.update(passed=False, message=str(error)[:2000])
                report["passed"] = False
    return report


def execute_release(*, wheel_path: str, wheel_sha256: str, runtime_digest: str, sdk_bundle_digest: str,
                    plugin_id: str, operator_id: str, version: str, config: dict, input_payload: dict | None) -> dict:
    response = _invoke(wheel_path=wheel_path, wheel_sha256=wheel_sha256, runtime_digest=runtime_digest,
                       sdk_bundle_digest=sdk_bundle_digest, request={"mode": "execute", "plugin_id": plugin_id,
                           "operator_id": operator_id, "version": version, "config": config, "input": input_payload})
    if not response.get("ok"):
        raise ValueError(response.get("error", "Plugin execution failed"))
    return response["artifact"]
