"""Contract fixtures are not evidence of a live Dagster/model run."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from pydantic import ValidationError

from shot_duration_plugin import ShotDurationConfig, filter_shots, plugin

ROOT = Path(__file__).resolve().parents[1]


class ShotDurationPluginTest(unittest.TestCase):
    def cases(self):
        return json.loads((ROOT / "test_cases.json").read_text())

    def test_complete_published_contract_fixtures(self):
        for case in self.cases():
            with self.subTest(case=case["name"]):
                original = deepcopy(case["input"])
                if "expected_error" in case:
                    self.assertEqual(case["expected_error"], {"type": "ValidationError"})
                    with self.assertRaises(ValidationError):
                        filter_shots(ShotDurationConfig.model_validate(case["config"]), case["input"])
                else:
                    output = filter_shots(ShotDurationConfig.model_validate(case["config"]), case["input"])
                    self.assertEqual(output, case["expected"])
                self.assertEqual(case["input"], original)

    def test_metadata_is_preserved_and_mutations_cannot_change_input(self):
        case = self.cases()[0]
        original = deepcopy(case["input"])
        output = filter_shots(ShotDurationConfig.model_validate(case["config"]), case["input"])
        output["records"][0]["metadata"]["embedding_spaces"]["fixture-space"] = {"path": "changed"}
        output["metadata"]["fixture"]["description"] = "changed"
        self.assertEqual(case["input"], original)

    def test_invalid_config_is_rejected_before_execution(self):
        for config in ({"min_duration_ms": -1}, {"max_duration_ms": 0},
                       {"min_duration_ms": 2000, "max_duration_ms": 1000},
                       {"min_duration_ms": "1000"}, {"min_duration_ms": True},
                       {"max_duration_ms": 2.5}, {"unexpected": "value"}):
            with self.subTest(config=config), self.assertRaises(ValidationError):
                ShotDurationConfig.model_validate(config)

    def test_invalid_shot_bounds_are_rejected_instead_of_silently_dropped(self):
        for start, end in ((True, 1000), (0, False), (-1, 1000), (1000, 1000),
                           (2000, 1000), (0, "1000"), (None, 1000)):
            case = deepcopy(self.cases()[0])
            case["input"]["records"][0]["metadata"].update(start_ms=start, end_ms=end)
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                filter_shots(ShotDurationConfig(), case["input"])

    def test_rejects_wrong_artifact_shape(self):
        for payload in (None, {}, {"type": "video_assets", "records": []},
                        {"type": "shot_assets", "records": {}},
                        {"type": "shot_assets", "records": [{}]}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                filter_shots(ShotDurationConfig(), payload)

    def test_manifest_matches_actual_sdk_definition_without_importing_server_code(self):
        declared = json.loads((ROOT / "manifest.json").read_text())
        definition = plugin()
        self.assertEqual(declared["id"], definition.id)
        self.assertEqual(declared["version"], definition.version)
        self.assertEqual(declared["sdk_version"], definition.sdk_version)
        self.assertEqual(len(declared["operators"]), len(definition.operators))
        for operator, expected in zip(definition.operators, declared["operators"], strict=True):
            live = operator.manifest(definition.id, definition.version)
            self.assertEqual({key: live[key] for key in expected}, expected)


if __name__ == "__main__":
    unittest.main()
