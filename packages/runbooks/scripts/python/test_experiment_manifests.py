"""Validate that every experiment manifest under runbooks/experiments/ conforms
to the meta-schema, and that the meta-schema rejects ill-formed manifests.

Run: cd ~/work/runbooks/scripts/python && uv run pytest test_experiment_manifests.py -v
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator, ValidationError

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENTS_DIR = REPO_ROOT / "experiments"
META_SCHEMA_PATH = EXPERIMENTS_DIR / "_schema" / "manifest.schema.json"


def _load_meta_schema() -> dict:
    return json.loads(META_SCHEMA_PATH.read_text())


def _all_manifest_paths() -> list[Path]:
    return sorted(p for p in EXPERIMENTS_DIR.glob("*/manifest.json") if "_schema" not in p.parts)


def test_meta_schema_is_valid_draft7():
    meta = _load_meta_schema()
    Draft7Validator.check_schema(meta)


def test_at_least_one_experiment_exists():
    assert _all_manifest_paths(), "no experiment manifests found under experiments/*/manifest.json"


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_manifest_validates_against_meta_schema(manifest_path: Path):
    meta = _load_meta_schema()
    manifest = json.loads(manifest_path.read_text())
    errors = sorted(
        Draft7Validator(meta).iter_errors(manifest),
        key=lambda e: [str(p) for p in e.absolute_path],
    )
    if errors:
        msgs = [f"  - {'.'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}" for e in errors]
        pytest.fail(f"{manifest_path.relative_to(REPO_ROOT)} fails meta-schema:\n" + "\n".join(msgs))


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_manifest_id_matches_directory(manifest_path: Path):
    manifest = json.loads(manifest_path.read_text())
    assert manifest["id"] == manifest_path.parent.name, (
        f"manifest id '{manifest['id']}' must match dir name '{manifest_path.parent.name}'"
    )


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_each_manifest_has_instruction(manifest_path: Path):
    instruction = manifest_path.parent / "instruction.md"
    assert instruction.exists(), f"missing {instruction.relative_to(REPO_ROOT)}"
    assert instruction.read_text().strip(), f"{instruction.relative_to(REPO_ROOT)} is empty"


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_input_schema_is_valid_jsonschema_draft7(manifest_path: Path):
    """The agent's input contract is itself JSON Schema Draft-07. gp-api validates dispatch params against this."""
    manifest = json.loads(manifest_path.read_text())
    Draft7Validator.check_schema(manifest["input_schema"])


@pytest.mark.parametrize("manifest_path", _all_manifest_paths(), ids=lambda p: p.parent.name)
def test_output_schema_is_valid_jsonschema_draft7(manifest_path: Path):
    """The artifact contract is itself JSON Schema Draft-07. Codegen depends on this."""
    manifest = json.loads(manifest_path.read_text())
    Draft7Validator.check_schema(manifest["output_schema"])


def _good_manifest() -> dict:
    paths = _all_manifest_paths()
    assert paths, "need at least one manifest as a starting point for negative tests"
    return json.loads(paths[0].read_text())


@pytest.mark.parametrize(
    "mutation,expected_message_fragment",
    [
        pytest.param(
            lambda m: m.pop("id"),
            "'id' is a required property",
            id="missing-id",
        ),
        pytest.param(
            lambda m: m.update({"id": "Voter Targeting"}),
            "does not match",
            id="id-with-spaces",
        ),
        pytest.param(
            lambda m: m.update({"timeout_seconds": 30}),
            "less than the minimum",
            id="timeout-too-low",
        ),
        pytest.param(
            lambda m: m.pop("output_schema"),
            "'output_schema' is a required property",
            id="missing-output-schema",
        ),
        pytest.param(
            lambda m: m.pop("input_schema"),
            "'input_schema' is a required property",
            id="missing-input-schema",
        ),
        pytest.param(
            lambda m: m.update({"unknown_field": "x"}),
            "Additional properties are not allowed",
            id="extra-top-level-field",
        ),
        pytest.param(
            lambda m: m.update({"scope": {"allowed_tables": ["FOO.bar.baz"], "max_rows": 100}}),
            "does not match",
            id="scope-table-uppercase-rejected",
        ),
        pytest.param(
            lambda m: m.update({"scope": {"allowed_tables": ["a.b.c"], "max_rows": 2_000_000}}),
            "is greater than the maximum",
            id="scope-max-rows-over-cap-rejected",
        ),
        pytest.param(
            lambda m: m.update({"version": "1"}),
            "is not of type 'integer'",
            id="version-not-integer",
        ),
    ],
)
def test_meta_schema_rejects_bad_manifests(mutation, expected_message_fragment):
    meta = _load_meta_schema()
    bad = copy.deepcopy(_good_manifest())
    mutation(bad)
    errors = list(Draft7Validator(meta).iter_errors(bad))
    assert errors, f"expected validation error containing '{expected_message_fragment}' but manifest validated"
    messages = " | ".join(e.message for e in errors)
    assert expected_message_fragment in messages, (
        f"expected '{expected_message_fragment}' in errors but got: {messages}"
    )


