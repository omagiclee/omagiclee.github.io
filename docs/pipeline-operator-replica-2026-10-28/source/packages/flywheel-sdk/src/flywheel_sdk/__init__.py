"""Public operator contracts for immutable Data Flywheel plugin releases.

Expose a PluginDefinition factory in the data_flywheel.operators entry-point
group with a name matching the plugin ID. Build a wheel, validate the candidate
in its fixed execution image, publish it, and enable that release in a project.
"""

from dataclasses import dataclass, field
import hashlib
import inspect
import json
from pathlib import Path
import re
from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ArtifactType = Literal["documents", "embeddings", "index", "video_assets", "shot_assets", "frame_assets", "annotated_frames", "frame_embeddings", "shot_index"]
ARTIFACT_TYPES = {"documents", "embeddings", "index", "video_assets", "shot_assets", "frame_assets", "annotated_frames", "frame_embeddings", "shot_index"}
MEDIA_ARTIFACT_TYPES = ARTIFACT_TYPES - {"documents", "embeddings", "index"}
ArtifactPayload = dict[str, Any]
OperatorHandler = Callable[[BaseModel, ArtifactPayload | None], ArtifactPayload]
ID_PATTERN = re.compile(r"^[a-z][a-z0-9_.-]{1,99}$")


class OperatorConfig(BaseModel):
    """Plugins should inherit this to reject misspelled configuration fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


class DocumentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=50_000)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        # IDs are opaque source identities. Do not silently normalize two source
        # IDs into one identity; require the producer to supply a canonical ID.
        if value != value.strip() or not value.strip():
            raise ValueError("record ID must be non-blank and have no surrounding whitespace")
        return value


@dataclass(frozen=True)
class OperatorDefinition:
    id: str
    name: str
    description: str
    kind: Literal["source", "transform", "sink"]
    input_type: ArtifactType | None
    output_type: ArtifactType
    config_model: type[BaseModel]
    handler: OperatorHandler
    default_config: dict[str, Any] = field(default_factory=dict)
    version: str = "1.0.0"
    deterministic: bool = True
    side_effects: bool = False
    # Authors should pin a release/build digest when behavior depends on files,
    # models or dependencies beyond the Python module containing this handler.
    implementation_revision: str = ""
    input_ports: dict[str, ArtifactType] = field(default_factory=dict)
    retry_safe: bool | None = None
    cacheable: bool | None = None

    @property
    def key(self) -> str:
        return f"{self.id}@{self.version}"

    def manifest(self, plugin_id: str, plugin_version: str) -> dict[str, Any]:
        try:
            source_path = inspect.getsourcefile(self.handler)
            implementation = Path(source_path).read_bytes() if source_path else inspect.getsource(self.handler).encode()
        except (OSError, TypeError):
            implementation = f"{self.handler.__module__}:{self.handler.__qualname__}".encode()
        schema = self.config_model.model_json_schema()
        extensions = {}
        if self.input_ports:
            extensions["input_ports"] = self.input_ports
        if self.retry_safe is not None:
            extensions["retry_safe"] = self.retry_safe
        if self.cacheable is not None:
            extensions["cacheable"] = self.cacheable
        digest = hashlib.sha256(implementation + json.dumps({
            "id": self.id, "version": self.version, "plugin_id": plugin_id,
            "plugin_version": plugin_version, "schema": schema,
            "revision": self.implementation_revision,
            "kind": self.kind, "input_type": self.input_type, "output_type": self.output_type,
            "deterministic": self.deterministic, "side_effects": self.side_effects, **extensions,
        }, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        return {
            "id": self.id, "key": self.key, "name": self.name,
            "version": self.version, "plugin_id": plugin_id,
            "description": self.description, "kind": self.kind,
            "input_type": self.input_type, "output_type": self.output_type,
            "config_schema": schema, "default_config": self.default_config,
            "deterministic": self.deterministic,
            "implementation_digest": digest,
            "execution_scope": "dataset", "side_effects": self.side_effects, **extensions,
        }


@dataclass(frozen=True)
class PluginDefinition:
    id: str
    name: str
    description: str
    operators: tuple[OperatorDefinition, ...]
    version: str = "1.0.0"
    sdk_version: str = "1"

    def manifest(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "version": self.version, "sdk_version": self.sdk_version,
            "operator_count": len(self.operators),
            "operators": [operator.key for operator in self.operators],
            "trust": "validated-release", "execution": "isolated-container",
        }
