"""Tests for the race_opponent_summary qa/main.py deterministic gate.

The gate is OBSERVE-ONLY: a failing check is still exit 0 with a fragment array
on stdout; a nonzero exit is reserved for an actual crash (missing schema file,
non-JSON artifact). These tests pin both the contract and the two code paths the
gate has — jsonschema present (schema validation runs) and jsonschema absent
(the production --no-dev path, where schema validation is skipped and a
malformed artifact must NOT crash the gate).
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# Don't litter the qa dir with __pycache__ — the publisher rejects subdirs
# under qa/, and a leftover __pycache__ would break publish_experiments.py.
sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[2]
EXP_DIR = REPO_ROOT / "experiments" / "race_opponent_summary"
MAIN_PATH = EXP_DIR / "qa" / "main.py"
MANIFEST_PATH = EXP_DIR / "manifest.json"


def _fresh_main():
    """Load qa/main.py as a fresh module object so a test that monkeypatches
    `main.jsonschema = None` does not leak into another test."""
    spec = importlib.util.spec_from_file_location("ros_qa_main", MAIN_PATH)
    assert spec and spec.loader, f"could not load {MAIN_PATH}"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _real_schema() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))["output_schema"]


def _valid_artifact() -> dict:
    return {
        "generated_at": "2026-06-28T00:00:00Z",
        "opponents": [
            {
                "opponent_name": "Jane Doe",
                "overview": {
                    "text": "Jane Doe is running for City Council.",
                    "sources": ["https://ballotpedia.org/Jane_Doe"],
                },
                "background": None,
                "key_positions": [
                    {
                        "label": "Housing",
                        "detail": "Supports more affordable housing.",
                        "sources": ["https://janedoe.com"],
                    }
                ],
            },
            {
                "opponent_name": "No Sources Sam",
                "overview": None,
                "background": None,
                "key_positions": [],
            },
        ],
    }


def _write_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    (ws / "contract_schema.json").write_text(
        json.dumps(_real_schema()), encoding="utf-8"
    )
    return ws


def _run_main(artifact_path: Path, workspace: Path) -> subprocess.CompletedProcess:
    import os

    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run(
        [
            sys.executable,
            "-B",
            str(MAIN_PATH),
            "--artifact",
            str(artifact_path),
            "--workspace",
            str(workspace),
        ],
        capture_output=True,
        text=True,
        cwd=str(MAIN_PATH.parent),
        env=env,
    )


def _names(fragments: list) -> set:
    return {f["name"] for f in fragments}


def _by_name(fragments: list, name: str) -> dict:
    return next(f for f in fragments if f["name"] == name)


class TestSchemaPresentPath:
    def test_valid_artifact_all_fragments_pass(self):
        main = _fresh_main()
        fragments = main.build_fragments(_valid_artifact(), _real_schema())
        assert _by_name(fragments, "schema_valid")["passed"] is True
        assert all(f["passed"] for f in fragments)

    def test_empty_opponents_fails_schema_and_short_circuits(self):
        """minItems:1 on the output opponents array makes [] schema-invalid; the
        gate emits only the failing schema_valid fragment and returns early."""
        main = _fresh_main()
        fragments = main.build_fragments(
            {"generated_at": "2026-06-28T00:00:00Z", "opponents": []},
            _real_schema(),
        )
        assert len(fragments) == 1
        assert _by_name(fragments, "schema_valid")["passed"] is False

    def test_section_missing_source_fails_attribution_shape(self):
        main = _fresh_main()
        art = _valid_artifact()
        # An overview object with an empty sources list is schema-invalid
        # (minItems:1), so use a permissive schema to exercise the shape check.
        permissive = {"type": "object"}
        art["opponents"][0]["overview"]["sources"] = []
        fragments = main.build_fragments(art, permissive)
        assert _by_name(fragments, "schema_valid")["passed"] is True
        assert _by_name(fragments, "attribution_shape")["passed"] is False


class TestSchemaAbsentPath:
    def test_skipped_schema_check_reported_unverified(self):
        """When jsonschema is unavailable the schema check is skipped and must be
        reported passed:false (indeterminate), never passed:true."""
        main = _fresh_main()
        main.jsonschema = None
        fragments = main.build_fragments(_valid_artifact(), _real_schema())
        sv = _by_name(fragments, "schema_valid")
        assert sv["passed"] is False
        assert sv["severity"] == "warning"

    def test_valid_artifact_still_graded_without_jsonschema(self):
        main = _fresh_main()
        main.jsonschema = None
        fragments = main.build_fragments(_valid_artifact(), _real_schema())
        assert _by_name(fragments, "opponents_present")["passed"] is True
        assert _by_name(fragments, "attribution_shape")["passed"] is True

    def test_empty_opponents_fails_present_check_and_short_circuits(self):
        main = _fresh_main()
        main.jsonschema = None
        fragments = main.build_fragments(
            {"generated_at": "2026-06-28T00:00:00Z", "opponents": []},
            _real_schema(),
        )
        assert _by_name(fragments, "opponents_present")["passed"] is False
        # An empty list early-returns: it must NOT fall through to a vacuous
        # attribution_shape passed=True (0 == 0) that contradicts the failure.
        assert "attribution_shape" not in _names(fragments)
        assert _names(fragments) == {"schema_valid", "opponents_present"}

    @pytest.mark.parametrize(
        "bad_opponents", [{"a": 1}, "a string", 5, None], ids=["dict", "str", "int", "none"]
    )
    def test_non_list_opponents_does_not_crash(self, bad_opponents):
        """A truthy non-list opponents value must not crash the gate — it fails
        opponents_present and returns, preserving the observe-only contract."""
        main = _fresh_main()
        main.jsonschema = None
        fragments = main.build_fragments(
            {"generated_at": "2026-06-28T00:00:00Z", "opponents": bad_opponents},
            _real_schema(),
        )
        assert _by_name(fragments, "opponents_present")["passed"] is False

    @pytest.mark.parametrize(
        "bad_element", [None, "a string", 5], ids=["none", "str", "int"]
    )
    def test_non_dict_opponent_element_does_not_crash(self, bad_element):
        """A non-dict element inside the opponents list must be skipped, not
        crash collect_sections via opp.get()."""
        main = _fresh_main()
        main.jsonschema = None
        art = {"generated_at": "2026-06-28T00:00:00Z", "opponents": [bad_element]}
        fragments = main.build_fragments(art, _real_schema())
        # opponents is a non-empty list, so the present check passes; the gate
        # must reach attribution without raising.
        assert _by_name(fragments, "opponents_present")["passed"] is True
        assert "attribution_shape" in _names(fragments)


class TestHasValidSources:
    def test_valid_http_sources(self):
        main = _fresh_main()
        assert main.has_valid_sources({"sources": ["https://x.com"]}) is True

    def test_empty_sources(self):
        main = _fresh_main()
        assert main.has_valid_sources({"sources": []}) is False

    def test_missing_sources_key(self):
        main = _fresh_main()
        assert main.has_valid_sources({}) is False

    def test_non_http_source(self):
        main = _fresh_main()
        assert main.has_valid_sources({"sources": ["ftp://x"]}) is False

    def test_non_string_source(self):
        main = _fresh_main()
        assert main.has_valid_sources({"sources": [None]}) is False


class TestCollectSections:
    def test_null_overview_and_background_omitted(self):
        main = _fresh_main()
        art = {
            "opponents": [
                {
                    "opponent_name": "Sam",
                    "overview": None,
                    "background": None,
                    "key_positions": [],
                }
            ]
        }
        assert main.collect_sections(art) == []

    def test_collects_non_null_sections_and_positions(self):
        main = _fresh_main()
        art = _valid_artifact()
        sections = main.collect_sections(art)
        # Jane: overview + one key_position; Sam: nothing.
        assert len(sections) == 2


class TestStdoutContractAndCrash:
    def test_valid_artifact_subprocess_exits_zero(self, tmp_path):
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps(_valid_artifact()), encoding="utf-8")
        proc = _run_main(artifact, ws)
        assert proc.returncode == 0, f"stderr:\n{proc.stderr}"
        fragments = json.loads(proc.stdout)
        assert isinstance(fragments, list) and fragments
        for frag in fragments:
            assert type(frag["name"]) is str
            assert type(frag["passed"]) is bool

    def test_failing_check_still_exits_zero(self, tmp_path):
        """An empty opponents array fails a check but is not a crash — exit 0."""
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text(
            json.dumps({"generated_at": "2026-06-28T00:00:00Z", "opponents": []}),
            encoding="utf-8",
        )
        proc = _run_main(artifact, ws)
        assert proc.returncode == 0, f"stderr:\n{proc.stderr}"
        assert _by_name(json.loads(proc.stdout), "schema_valid")["passed"] is False

    def test_missing_contract_schema_exits_nonzero(self, tmp_path):
        ws = tmp_path / "ws"
        ws.mkdir()  # deliberately no contract_schema.json
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps(_valid_artifact()), encoding="utf-8")
        proc = _run_main(artifact, ws)
        assert proc.returncode != 0
        assert str(ws / "contract_schema.json") in proc.stderr

    def test_non_json_artifact_raises_runtime_error(self, tmp_path):
        main = _fresh_main()
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text("this is not json {", encoding="utf-8")
        with pytest.raises(RuntimeError) as exc:
            main.main(["--artifact", str(artifact), "--workspace", str(ws)])
        assert "not valid JSON" in str(exc.value)

    @pytest.mark.parametrize(
        "root", ["[]", "null", "42", '"a string"'], ids=["list", "null", "int", "str"]
    )
    def test_valid_json_non_dict_root_raises_runtime_error(self, tmp_path, root):
        """A valid-JSON but non-dict artifact root is ungradeable — same crash
        class as a non-JSON file (load_schema guards this too)."""
        main = _fresh_main()
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text(root, encoding="utf-8")
        with pytest.raises(RuntimeError) as exc:
            main.main(["--artifact", str(artifact), "--workspace", str(ws)])
        assert "not a dict" in str(exc.value)


class TestGradingBackstop:
    def test_unexpected_grading_exception_degrades_to_gate_error(
        self, tmp_path, monkeypatch, capsys
    ):
        """A parseable artifact whose grading would otherwise raise must produce a
        gate_error fragment at exit 0, never a nonzero crash (observe-only)."""
        main = _fresh_main()
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps(_valid_artifact()), encoding="utf-8")

        def _boom(*_args, **_kwargs):
            raise RuntimeError("synthetic grading failure")

        monkeypatch.setattr(main, "build_fragments", _boom)

        rc = main.main(["--artifact", str(artifact), "--workspace", str(ws)])
        assert rc == 0
        fragments = json.loads(capsys.readouterr().out)
        ge = _by_name(fragments, "gate_error")
        assert ge["passed"] is False
        assert "synthetic grading failure" in ge["detail"]


class TestStdoutCap:
    def test_cap_drops_detail_and_preserves_name_passed(self):
        main = _fresh_main()
        big = "x" * 50_000
        fragments = [
            {"name": f"f_{i}", "passed": True, "type": "deterministic", "detail": big}
            for i in range(40)  # 40 * 50KB = 2MB, well over the 1MB cap
        ]
        raw = json.dumps(fragments)
        assert len(raw.encode("utf-8")) > main.STDOUT_CAP_BYTES
        capped = main.cap_stdout(fragments)
        assert len(capped.encode("utf-8")) <= main.STDOUT_CAP_BYTES
        for frag in json.loads(capped):
            assert type(frag["name"]) is str
            assert type(frag["passed"]) is bool
            assert "detail" not in frag


class TestFixtureGuard:
    def test_valid_artifact_is_schema_valid(self):
        import jsonschema

        errors = sorted(
            jsonschema.Draft7Validator(_real_schema()).iter_errors(_valid_artifact()),
            key=lambda e: list(e.path),
        )
        assert errors == [], (
            "valid fixture no longer satisfies the real race_opponent_summary "
            "output_schema (schema drift in manifest.json): "
            + "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:10])
        )
