"""A standalone, side-effect-free operator for real video shot artifacts."""
from copy import deepcopy
from typing import Any

from pydantic import Field, model_validator

from flywheel_sdk import OperatorConfig, OperatorDefinition, PluginDefinition

VERSION = "1.0.0"


class ShotDurationConfig(OperatorConfig):
    min_duration_ms: int = Field(default=1000, ge=0, description="最短镜头时长（毫秒），包含此边界")
    max_duration_ms: int = Field(default=30000, ge=1, description="最长镜头时长（毫秒），包含此边界")

    @model_validator(mode="after")
    def ordered_range(self):
        if self.max_duration_ms < self.min_duration_ms:
            raise ValueError("max_duration_ms must be greater than or equal to min_duration_ms")
        return self


def filter_shots(config: ShotDurationConfig, payload: dict[str, Any] | None) -> dict[str, Any]:
    """Keep input order and complete artifact/record metadata; never open references.

    Shot intervals are [start_ms, end_ms), so duration is end_ms - start_ms.
    The accepted duration range itself is closed: [minimum, maximum].
    """
    if not isinstance(payload, dict) or payload.get("type") != "shot_assets":
        raise ValueError("input must be a shot_assets artifact")
    if not isinstance(payload.get("records"), list) or not isinstance(payload.get("metadata", {}), dict):
        raise ValueError("input must contain a records list and object metadata")
    selected = []
    for record in payload["records"]:
        if not isinstance(record, dict) or not isinstance(record.get("metadata"), dict):
            raise ValueError("each shot must have object metadata")
        start = record["metadata"].get("start_ms")
        end = record["metadata"].get("end_ms")
        if type(start) is not int or type(end) is not int or start < 0 or end <= start:
            raise ValueError("shot bounds require integer milliseconds with 0 <= start_ms < end_ms")
        if config.min_duration_ms <= end - start <= config.max_duration_ms:
            selected.append(record)
    # Keep nested provenance and file references intact without sharing mutable objects.
    return deepcopy({**payload, "records": selected})


def plugin() -> PluginDefinition:
    return PluginDefinition(
        id="project.shot_duration",
        name="视频镜头时长筛选",
        description="按毫秒范围筛选镜头，保留原始视频、时间边界和所有来源引用。",
        version=VERSION,
        operators=(OperatorDefinition(
            id="project.shot_duration_filter",
            name="镜头时长筛选",
            description="保留时长位于闭区间内的镜头；不读取视频、不执行模型、不修改数据目录。",
            kind="transform",
            input_type="shot_assets",
            output_type="shot_assets",
            config_model=ShotDurationConfig,
            handler=filter_shots,
            default_config={"min_duration_ms": 1000, "max_duration_ms": 30000},
            version=VERSION,
            deterministic=True,
            side_effects=False,
            implementation_revision="shot-duration-v1:integer-ms:inclusive-range:preserve-payload",
        ),),
    )
