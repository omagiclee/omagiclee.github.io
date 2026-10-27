"""Declarative plugin contracts; no uploaded code is imported by the API."""
from copy import deepcopy
from types import SimpleNamespace

from jsonschema import Draft202012Validator, validators
from referencing import Registry
from referencing.exceptions import NoSuchResource


def _no_remote_schema(uri):
    raise NoSuchResource(ref=uri)


def definition_from_manifest(manifest):
    schema = deepcopy(manifest["config_schema"])
    Draft202012Validator.check_schema(schema)
    strict_types = Draft202012Validator.TYPE_CHECKER.redefine("integer", lambda _checker, value: type(value) is int)
    strict_validator = validators.extend(Draft202012Validator, type_checker=strict_types)
    validator = strict_validator(schema, registry=Registry(retrieve=_no_remote_schema))

    class Configuration:
        @classmethod
        def model_validate(cls, value):
            try:
                errors = list(validator.iter_errors(value))
            except Exception as error:
                raise ValueError("Plugin schema cannot be resolved locally") from error
            if errors:
                raise ValueError("Plugin configuration is invalid: " + "; ".join(error.message for error in errors[:5]))
            return deepcopy(value)

        @classmethod
        def model_json_schema(cls):
            return deepcopy(schema)

    return SimpleNamespace(**{key: manifest[key] for key in ("id", "version", "kind", "input_type", "output_type")},
                           config_model=Configuration, input_ports=manifest.get("input_ports", {}),
                           retry_safe=manifest.get("retry_safe"), cacheable=manifest.get("cacheable"))


def execute_manifest(manifest, config, input_payload, project_id):
    from .plugin_release_service import resolve_release
    from .plugin_release_runner import execute_release
    release = resolve_release(manifest["release_id"], project_id)
    actual = next((item for item in release["operator_manifests"] if item["key"] == manifest["key"]), None)
    identity = ("implementation_digest", "runtime_digest", "sdk_bundle_digest", "wheel_sha256", "release_id")
    if not actual or any(actual.get(key) != manifest.get(key) for key in identity):
        raise ValueError("Published plugin no longer matches the immutable pipeline snapshot")
    if any(release.get(key) != manifest.get(key) for key in ("release_id", "runtime_digest", "sdk_bundle_digest", "wheel_sha256")):
        raise ValueError("Plugin release artifact identities differ from the immutable pipeline snapshot")
    return execute_release(wheel_path=release["wheel_path"], wheel_sha256=release["wheel_sha256"],
        runtime_digest=release["runtime_digest"], sdk_bundle_digest=release["sdk_bundle_digest"],
        plugin_id=manifest["plugin_id"], operator_id=manifest["id"], version=manifest["version"],
        config=config, input_payload=input_payload)
