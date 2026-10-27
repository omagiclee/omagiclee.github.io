"""JSON subprocess protocol. Deliberately imports no application/DB/auth modules."""

from contextlib import redirect_stdout
import json
import sys

from .pipeline_runtime import MAX_PAYLOAD_BYTES, MAX_REQUEST_BYTES, _execute_in_worker


def main() -> int:
    try:
        # Bound normal file/stdout/stderr growth in this prototype worker. This
        # resource limit is operational protection, not a hostile-code sandbox.
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PAYLOAD_BYTES + 65_536, MAX_PAYLOAD_BYTES + 65_536))
        except (ImportError, OSError, ValueError):
            pass
        content = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(content) > MAX_REQUEST_BYTES:
            raise ValueError("worker request exceeds the local execution limit")
        request = json.loads(content)
        with redirect_stdout(sys.stderr):
            artifact = _execute_in_worker(**request)
        result = {"ok": True, "artifact": artifact}
        status = 0
    except Exception as error:
        result = {"ok": False, "error": f"{type(error).__name__}: {error}"[:4000]}
        status = 1
    sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
