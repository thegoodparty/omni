"""Red/green tests for the meeting_briefing qa/main.py THIN ORCHESTRATOR (contract B/C).

qa/main.py is no longer a "ported copy" of the checks. It is a thin orchestrator
that IMPORTS qa_checks (the single source of truth, living as a sibling in qa/):

  - argparse `--artifact <path> --workspace <root>` (no hardcoded /workspace paths)
  - schema resolved from <workspace>/contract_schema.json
  - it calls qa_checks.validate_schema(artifact, schema) and, if schema-valid,
    runs qa_checks.CHECKS to build findings — it does NOT duplicate any check
    logic and does NOT call qa_checks.run() (which carries hardcoded /workspace
    paths and a different signature)
  - main() emits a JSON ARRAY of check fragments on stdout (contract C), exit 0
    even when checks fail; a nonzero exit is reserved for an actual crash

The single-source link is locked directly: main reuses qa_checks's CHECKS list,
Finding/Report, and validate_schema by IDENTITY (the same objects), so a future
edit that re-inlines the checks into main.py (re-introducing drift) fails here.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Don't litter the qa dir with __pycache__ — the publisher rejects subdirs
# under qa/, and a leftover __pycache__ would break publish_experiments.py.
sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[2]
QA_DIR = REPO_ROOT / "experiments" / "meeting_briefing" / "qa"
MAIN_PATH = QA_DIR / "main.py"
QA_CHECKS_PATH = QA_DIR / "qa_checks.py"
MANIFEST_PATH = REPO_ROOT / "experiments" / "meeting_briefing" / "manifest.json"


def _ensure_qa_on_path():
    # The qa dir must be importable so main.py's `import qa_checks` (a sibling)
    # resolves — at gate time cwd is the qa dir; here we put it on sys.path.
    if str(QA_DIR) not in sys.path:
        sys.path.insert(0, str(QA_DIR))


def _main():
    """Load main.py. main.py does a normal `import qa_checks`, so after this the
    SAME qa_checks module object is in sys.modules['qa_checks'] — _qa_checks()
    returns that exact object so the single-source identity assertions are real
    (not defeated by loading qa_checks twice under two module objects)."""
    _ensure_qa_on_path()
    spec = importlib.util.spec_from_file_location("mb_qa_main", MAIN_PATH)
    assert spec and spec.loader, f"could not load {MAIN_PATH}"
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mb_qa_main"] = mod
    spec.loader.exec_module(mod)
    return mod


def _qa_checks():
    """The qa_checks module main.py imported (same object). Importing main first
    via _main() populates sys.modules['qa_checks']; fall back to a direct import
    if a test calls _qa_checks() without _main()."""
    _ensure_qa_on_path()
    if "qa_checks" not in sys.modules:
        import qa_checks  # noqa: F401
    return sys.modules["qa_checks"]


def _real_schema() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return manifest["output_schema"]


def _minimal_valid_artifact() -> dict:
    """Smallest instance satisfying the MeetingBriefingPlaceholder oneOf branch
    (awaiting_agenda), with all 4 discovery channels so the deterministic
    checks all pass on a clean artifact."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "experiment_id": "meeting_briefing",
        "briefing_type": "city_council_meeting",
        "briefing_status": "awaiting_agenda",
        "generated_at": now,
        "official_name": "Jane Doe",
        "meeting_name": "City Council",
        "location": "City Hall",
        "meeting_date": "2026-07-01",
        "meeting_time": "19:00",
        "meeting_timezone": "America/New_York",
        "estimated_read_minutes": 0,
        "executive_summary": {
            "lead_in": "The agenda packet for this meeting has not been published yet.",
            "items": [],
        },
        "run_metadata": {
            "agenda_packet_url": None,
            "source_bundle_retrieved_at": now,
            "discovered_agenda_location": "https://example.gov/government/city-council/meetings",
            "run_decisions": [
                {"timestamp": now, "decision": f"channel_{n}_probed", "reason": "checked"}
                for n in range(1, 5)
            ],
        },
        "items": [
            {
                "id": "item_001",
                "item_number": None,
                "title": "Awaiting agenda packet",
                "tier": "standard",
                "vote_required": False,
                "tier_reason": ["placeholder"],
                "display": {
                    "summary": "The agenda packet has not been published yet.",
                    "constituent_sentiment": None,
                    "recent_news": None,
                    "budget_impact": None,
                    "talking_points": None,
                },
                "research": {
                    "raw_context": [
                        {
                            "chunk_id": "chunk_1",
                            "item_id": "item_001",
                            "item_title": "Awaiting agenda packet",
                            "tier": "standard",
                            "source_id": "src_1",
                            "pages": [1],
                            "text": "Meeting confirmed on the calendar; packet pending.",
                        }
                    ],
                    "full_treatment": None,
                },
            }
        ],
        "claims": [],
        "sources": [
            {
                "id": "src_1",
                "name": "City calendar",
                "source_type": "government_website",
                "retrieved_at": now,
                "retrieved_text_or_snapshot": "Council meeting scheduled; agenda forthcoming.",
            }
        ],
        "required_data_points": [],
        "disclosure": (
            "This briefing was produced with AI assistance and may contain errors. "
            "Constituent sentiment figures are a modeled estimate."
        ),
    }


def _briefing_ready_artifact() -> dict:
    """Smallest schema-valid instance satisfying the briefing_ready oneOf branch,
    with one complete featured item and one claim whose cross-references resolve
    and whose extract is present in its cited source. All deterministic checks
    pass on this artifact (no findings)."""
    art = _minimal_valid_artifact()
    art["briefing_status"] = "briefing_ready"
    art["estimated_read_minutes"] = 4
    art["executive_summary"] = {
        "lead_in": "Council meets to consider one featured item.",
        "items": [
            {
                "item_id": "item_001",
                "title": "Awaiting agenda packet",
                "overview": "A featured agenda item summary.",
            }
        ],
    }
    art["items"][0]["tier"] = "featured"
    art["items"][0]["item_number"] = "1A"
    art["items"][0]["title"] = "Budget amendment"
    art["items"][0]["display"]["summary"] = "A featured agenda item."
    art["items"][0]["display"]["talking_points"] = [
        "Point one about the item.",
        "Point two about the item.",
        "Point three about the item.",
    ]
    art["claims"] = [
        {
            "claim_id": "claim_001",
            "item_id": "item_001",
            "section": "overview",
            "claim_text": "Some factual claim.",
            "claim_type": "inferred",
            "claim_weight": "low",
            "source_extracts": ["Council meeting scheduled; agenda forthcoming."],
            "source_ids": ["src_1"],
            "required_source_type": "none",
            "route_if_unsupported": "flag_as_inferred",
        }
    ]
    return art


def _write_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    (ws / "contract_schema.json").write_text(json.dumps(_real_schema()), encoding="utf-8")
    return ws


def _run_main(artifact_path: Path, workspace: Path) -> subprocess.CompletedProcess:
    # cwd is the qa dir so main.py's `import qa_checks` resolves (contract B).
    # PYTHONDONTWRITEBYTECODE keeps the subprocess from dropping a __pycache__
    # under qa/ — the publisher rejects any subdir under qa/, so a stray cache
    # dir would break publish_experiments.py.
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


# ---------------------------------------------------------------------------
# Single-source link: main reuses qa_checks's pieces by IDENTITY, never a copy.
# This is the load-bearing guarantee — if a future edit re-inlines the checks
# into main.py (re-introducing drift), these identity assertions break.
# ---------------------------------------------------------------------------


class TestSingleSourceLink:
    def test_main_reuses_qa_checks_CHECKS_list_by_identity(self):
        main = _main()
        qc = _qa_checks()
        assert main.CHECKS is qc.CHECKS, (
            "main.py must reuse qa_checks.CHECKS directly (single source of truth), "
            "not a re-inlined copy"
        )

    def test_main_reuses_qa_checks_validate_schema_and_dataclasses(self):
        main = _main()
        qc = _qa_checks()
        assert main.validate_schema is qc.validate_schema
        assert main.Finding is qc.Finding
        assert main.Report is qc.Report

    def test_qa_checks_list_has_all_ten_checks(self):
        qc = _qa_checks()
        assert len(qc.CHECKS) == 10
        names = [c.__name__ for c in qc.CHECKS]
        assert "check_cross_reference_integrity" in names
        assert "check_disclosure_present" in names

    def test_qa_checks_dead_driver_surface_removed(self):
        """The old qa_checks driver surface is gone — qa_checks is now a pure
        check LIBRARY (validate_schema + CHECKS + Finding/Report), imported by
        main.py. The removed symbols (run, load_schema_from_manifest,
        print_report, main, and the hardcoded path constants) must NOT exist:
        this is the strongest form of the single-source contract — main.py
        cannot regress to calling a hardcoded-/workspace driver that doesn't
        exist. If a future edit re-adds any of them, this test flags it."""
        qc = _qa_checks()
        for symbol in (
            "run",
            "load_schema_from_manifest",
            "print_report",
            "main",
            "RUNTIME_SCHEMA_PATH",
            "DEV_MANIFEST_PATH",
            "DEFAULT_ARTIFACT_PATH",
        ):
            assert not hasattr(qc, symbol), (
                f"qa_checks.{symbol} should have been removed — qa_checks is the "
                "pure check library, not a driver"
            )

    def test_main_drives_checks_directly_without_a_qa_checks_driver(self):
        """main builds findings from qa_checks.CHECKS directly via run_checks,
        not through any qa_checks driver entrypoint. A clean artifact yields
        all-passing fragments."""
        main = _main()
        report = main.run_checks(_minimal_valid_artifact(), _real_schema())
        fragments = main.report_to_fragments(report)
        assert all(f["passed"] for f in fragments)
        assert any(f["name"] == "schema_valid" and f["passed"] is True for f in fragments)


# ---------------------------------------------------------------------------
# argparse contract
# ---------------------------------------------------------------------------


class TestArgparse:
    def test_parses_artifact_and_workspace(self, tmp_path):
        main = _main()
        artifact = tmp_path / "a.json"
        artifact.write_text("{}", encoding="utf-8")
        ns = main.parse_args(["--artifact", str(artifact), "--workspace", str(tmp_path)])
        assert ns.artifact == str(artifact)
        assert ns.workspace == str(tmp_path)

    def test_missing_artifact_exits_nonzero(self):
        main = _main()
        with pytest.raises(SystemExit) as exc:
            main.parse_args(["--workspace", "/tmp"])
        assert exc.value.code != 0

    def test_missing_workspace_exits_nonzero(self):
        main = _main()
        with pytest.raises(SystemExit) as exc:
            main.parse_args(["--artifact", "/tmp/a.json"])
        assert exc.value.code != 0


# ---------------------------------------------------------------------------
# stdout fragment-array contract (subprocess against the REAL schema).
# Fragments are the unit of truth; clean artifact -> all pass; an unresolved
# cross-reference -> a failing fragment named for that check.
# ---------------------------------------------------------------------------


def _assert_contract_c_meta_schema(fragments: list) -> None:
    assert isinstance(fragments, list)
    assert len(fragments) >= 1
    for frag in fragments:
        assert type(frag["name"]) is str, f"name not str: {frag!r}"
        assert type(frag["passed"]) is bool, f"passed not bool: {frag!r}"


class TestStdoutContract:
    def test_clean_artifact_all_fragments_pass(self, tmp_path):
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps(_minimal_valid_artifact()), encoding="utf-8")

        proc = _run_main(artifact, ws)
        assert proc.returncode == 0, f"stderr:\n{proc.stderr}"

        fragments = json.loads(proc.stdout)
        _assert_contract_c_meta_schema(fragments)
        sv = [f for f in fragments if f["name"] == "schema_valid"]
        assert len(sv) == 1 and sv[0]["passed"] is True
        assert all(f["passed"] for f in fragments)

    def test_unresolved_claim_item_id_yields_failing_fragment(self, tmp_path):
        ws = _write_workspace(tmp_path)
        art = _minimal_valid_artifact()
        # briefing_ready so claims[] is schema-allowed; introduce a claim that
        # references a non-existent item -> the cross-ref check must fail.
        art["briefing_status"] = "briefing_ready"
        art["items"][0]["tier"] = "featured"
        art["items"][0]["item_number"] = "1A"
        art["items"][0]["display"]["summary"] = "A featured agenda item."
        art["items"][0]["display"]["talking_points"] = [
            "Point one about the item.",
            "Point two about the item.",
            "Point three about the item.",
        ]
        art["executive_summary"]["items"] = [
            {
                "item_id": "item_001",
                "title": "Awaiting agenda packet",
                "overview": "A featured agenda item summary.",
            }
        ]
        art["claims"] = [
            {
                "claim_id": "claim_001",
                "item_id": "item_999",  # unresolved cross-reference
                "section": "overview",
                "claim_text": "Some factual claim.",
                "claim_type": "inferred",
                "claim_weight": "low",
                "source_extracts": ["Council meeting scheduled; agenda forthcoming."],
                "source_ids": ["src_1"],
                "required_source_type": "none",
                "route_if_unsupported": "flag_as_inferred",
            }
        ]
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps(art), encoding="utf-8")

        proc = _run_main(artifact, ws)
        # A failing check still exits 0 — nonzero is reserved for a crash.
        assert proc.returncode == 0, f"stderr:\n{proc.stderr}"

        fragments = json.loads(proc.stdout)
        sv = [f for f in fragments if f["name"] == "schema_valid"]
        assert len(sv) == 1 and sv[0]["passed"] is True, f"schema invalid: {sv}"

        failing = [f for f in fragments if f["passed"] is False]
        names = {f["name"] for f in failing}
        assert "claim.item_id_unresolved" in names
        # The failing cross-ref fragment carries error severity in its note.
        xref = next(f for f in failing if f["name"] == "claim.item_id_unresolved")
        assert xref["severity"] == "error"

    def test_warning_finding_emits_passing_warning_fragment(self, tmp_path):
        """A briefing_ready artifact whose discovered_agenda_location is a '.pdf'
        deep link triggers a WARNING-severity finding. That must surface as a
        passing fragment carrying severity 'warning' — warnings never block."""
        ws = _write_workspace(tmp_path)
        art = _briefing_ready_artifact()
        art["run_metadata"]["discovered_agenda_location"] = (
            "https://example.gov/agenda-2026-06-08.pdf"
        )
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps(art), encoding="utf-8")

        proc = _run_main(artifact, ws)
        assert proc.returncode == 0, f"stderr:\n{proc.stderr}"

        fragments = json.loads(proc.stdout)
        _assert_contract_c_meta_schema(fragments)
        deep = [f for f in fragments if f["name"] == "discovered_agenda_location.deep_link"]
        assert len(deep) == 1
        assert deep[0]["passed"] is True
        assert deep[0]["severity"] == "warning"
        assert all(f["passed"] for f in fragments)


class TestSchemaSource:
    def test_schema_invalid_skips_checks_and_marks_schema_valid_false(self, tmp_path):
        """An artifact that violates the schema yields schema_valid passed:false
        and the 10 checks are skipped (preserving qa_checks.py behavior)."""
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps({"briefing_status": "awaiting_agenda"}), encoding="utf-8")

        proc = _run_main(artifact, ws)
        assert proc.returncode == 0, f"stderr:\n{proc.stderr}"

        fragments = json.loads(proc.stdout)
        sv = [f for f in fragments if f["name"] == "schema_valid"]
        assert len(sv) == 1 and sv[0]["passed"] is False
        check_names = {
            "run_decisions.discovery_channels_incomplete",
            "discovered_agenda_location.missing",
            "claim.item_id_unresolved",
            "briefing_status.consistency",
        }
        assert not (check_names & {f["name"] for f in fragments})

    def test_reads_contract_schema_from_workspace_arg(self, tmp_path):
        """main resolves the schema from <workspace>/contract_schema.json, NOT a
        hardcoded /workspace path. A permissive schema in the tmp workspace makes
        an artifact valid that the real schema would reject."""
        ws = tmp_path / "ws"
        ws.mkdir()
        (ws / "contract_schema.json").write_text(
            json.dumps({"type": "object"}), encoding="utf-8"
        )
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps({"briefing_status": "briefing_ready"}), encoding="utf-8")

        proc = _run_main(artifact, ws)
        assert proc.returncode == 0, f"stderr:\n{proc.stderr}"

        fragments = json.loads(proc.stdout)
        sv = [f for f in fragments if f["name"] == "schema_valid"]
        assert len(sv) == 1 and sv[0]["passed"] is True, (
            "main did not read the permissive contract_schema.json from --workspace"
        )


# ---------------------------------------------------------------------------
# Crash-exit contract: a real crash (missing schema / missing / bad artifact)
# is a NONZERO exit carrying a greppable RuntimeError message. The engine turns
# that into a synthetic main_py_exit fragment. A check FAILURE is never a crash.
# ---------------------------------------------------------------------------


class TestCrashExit:
    def test_missing_contract_schema_exits_nonzero(self, tmp_path):
        ws = tmp_path / "ws"
        ws.mkdir()  # deliberately no contract_schema.json
        artifact = tmp_path / "artifact.json"
        artifact.write_text(json.dumps(_minimal_valid_artifact()), encoding="utf-8")

        proc = _run_main(artifact, ws)
        assert proc.returncode != 0
        assert str(ws / "contract_schema.json") in proc.stderr

    def test_missing_artifact_file_raises_runtime_error_with_path(self, tmp_path):
        main = _main()
        ws = _write_workspace(tmp_path)
        missing = tmp_path / "does_not_exist.json"
        with pytest.raises(RuntimeError) as exc:
            main.main(["--artifact", str(missing), "--workspace", str(ws)])
        msg = str(exc.value)
        assert str(missing) in msg
        assert "artifact not found" in msg

    def test_non_json_artifact_raises_runtime_error_with_path(self, tmp_path):
        main = _main()
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text("this is not json {", encoding="utf-8")
        with pytest.raises(RuntimeError) as exc:
            main.main(["--artifact", str(artifact), "--workspace", str(ws)])
        msg = str(exc.value)
        assert str(artifact) in msg
        assert "not valid JSON" in msg

    def test_non_json_artifact_subprocess_exits_nonzero_with_lead_line(self, tmp_path):
        ws = _write_workspace(tmp_path)
        artifact = tmp_path / "artifact.json"
        artifact.write_text("this is not json {", encoding="utf-8")
        proc = _run_main(artifact, ws)
        assert proc.returncode != 0
        assert str(artifact) in proc.stderr
        assert "not valid JSON" in proc.stderr


# ---------------------------------------------------------------------------
# stdout cap (1 MB, contract B): over-cap output drops per-fragment detail but
# preserves name/passed; serialized payload stays <= the cap.
# ---------------------------------------------------------------------------


class TestStdoutCap:
    def test_cap_drops_detail_and_preserves_name_passed(self):
        main = _main()
        big = "x" * 50_000
        findings = [
            main.Finding(check=f"check_{i}", severity="error", message=big)
            for i in range(40)  # 40 * 50KB = 2MB of detail, well over the cap
        ]
        report = main.Report(artifact_path="", schema_valid=True, findings=findings)

        fragments = main.report_to_fragments(report)
        assert any("detail" in f for f in fragments if f["name"] != "schema_valid")
        raw = json.dumps(fragments)
        assert len(raw.encode("utf-8")) > main.STDOUT_CAP_BYTES

        capped = main.cap_stdout(fragments)
        assert len(capped.encode("utf-8")) <= main.STDOUT_CAP_BYTES
        for frag in json.loads(capped):
            assert type(frag["name"]) is str
            assert type(frag["passed"]) is bool
            assert "detail" not in frag, "detail should have been the dropped field"


# ---------------------------------------------------------------------------
# Fragment mapping unit tests (against report_to_fragments directly).
# ---------------------------------------------------------------------------


class TestReportToFragments:
    def test_schema_invalid_emits_only_failing_schema_fragment(self):
        main = _main()
        report = main.Report(
            artifact_path="", schema_valid=False, schema_errors=["$['x']: missing"]
        )
        fragments = main.report_to_fragments(report)
        assert len(fragments) == 1
        assert fragments[0]["name"] == "schema_valid"
        assert fragments[0]["passed"] is False
        assert fragments[0]["severity"] == "error"

    def test_schema_invalid_with_finding_short_circuits_before_checks(self):
        """Kills the report_to_fragments early-return mutant. A schema-INVALID
        report that ALSO carries a finding must emit ONLY the schema_valid
        fragment (passed:false) — the finding-derived fragment must NOT appear,
        because a schema-invalid report short-circuits before the checks ran
        (the findings are stale/inapplicable). Deleting the early-return guard
        would leak the finding fragment, which this test forbids."""
        main = _main()
        report = main.Report(
            artifact_path="",
            schema_valid=False,
            schema_errors=["$['x']: missing"],
            findings=[main.Finding(check="cross_ref", severity="error", message="msg")],
        )
        fragments = main.report_to_fragments(report)
        assert len(fragments) == 1
        assert fragments[0]["name"] == "schema_valid"
        assert fragments[0]["passed"] is False
        assert "cross_ref" not in {f["name"] for f in fragments}

    def test_error_finding_maps_to_failing_fragment(self):
        main = _main()
        report = main.Report(
            artifact_path="",
            schema_valid=True,
            findings=[main.Finding(check="some.error", severity="error", message="bad")],
        )
        fragments = main.report_to_fragments(report)
        frag = next(f for f in fragments if f["name"] == "some.error")
        assert frag["passed"] is False
        assert frag["severity"] == "error"
        assert frag["detail"] == "bad"

    def test_warning_finding_maps_to_passing_fragment(self):
        main = _main()
        report = main.Report(
            artifact_path="",
            schema_valid=True,
            findings=[main.Finding(check="some.warn", severity="warning", message="fyi")],
        )
        fragments = main.report_to_fragments(report)
        frag = next(f for f in fragments if f["name"] == "some.warn")
        assert frag["passed"] is True
        assert frag["severity"] == "warning"


# ---------------------------------------------------------------------------
# Fixture guard — the artifacts the stdout tests build must validate against the
# REAL meeting_briefing output_schema, so a schema drift fails HERE with a clear
# diagnostic instead of as a confusing "a fragment didn't pass".
# ---------------------------------------------------------------------------


class TestFixtureGuard:
    def test_minimal_valid_artifact_is_schema_valid(self):
        import jsonschema

        errors = sorted(
            jsonschema.Draft7Validator(_real_schema()).iter_errors(_minimal_valid_artifact()),
            key=lambda e: list(e.path),
        )
        assert errors == [], (
            "minimal valid artifact no longer satisfies the real meeting_briefing "
            "output_schema (schema drift in manifest.json): "
            + "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:10])
        )

    def test_briefing_ready_artifact_is_schema_valid(self):
        import jsonschema

        errors = sorted(
            jsonschema.Draft7Validator(_real_schema()).iter_errors(_briefing_ready_artifact()),
            key=lambda e: list(e.path),
        )
        assert errors == [], (
            "briefing_ready fixture no longer satisfies the real output_schema: "
            + "; ".join(f"{list(e.path)}: {e.message}" for e in errors[:10])
        )


class TestChannel0ConfirmedBailExemption:
    """A channel-0 POSITIVE read (confirmed bail) exempts a miss artifact from the
    4-channel discovery-depth requirement; an unreachable/unconfirmed channel 0
    does NOT — it must still exhaust channels 1-4."""

    def _decisions(self, *labels):
        now = datetime.now(timezone.utc).isoformat()
        return [{"timestamp": now, "decision": l, "reason": "channel-0 outcome"} for l in labels]

    def test_confirmed_no_agenda_yet_exempts_awaiting_agenda(self):
        qc = _qa_checks()
        art = _minimal_valid_artifact()  # awaiting_agenda
        art["run_metadata"]["run_decisions"] = self._decisions("channel_0_confirmed_no_agenda_yet")
        findings = []
        qc.check_awaiting_agenda_discovery_depth(art, findings)
        assert findings == [], "confirmed-no-agenda-yet should exempt the 4-channel check"

    def test_confirmed_no_meeting_exempts_no_meeting_found(self):
        qc = _qa_checks()
        art = _minimal_valid_artifact()
        art["briefing_status"] = "no_meeting_found"
        art["run_metadata"]["run_decisions"] = self._decisions("channel_0_confirmed_no_meeting")
        findings = []
        qc.check_awaiting_agenda_discovery_depth(art, findings)
        assert findings == [], "confirmed-no-meeting should exempt the 4-channel check"

    def test_unreachable_channel0_still_requires_four_channels(self):
        qc = _qa_checks()
        art = _minimal_valid_artifact()
        art["run_metadata"]["run_decisions"] = self._decisions("channel_0_unreachable_or_unconfirmed")
        findings = []
        qc.check_awaiting_agenda_discovery_depth(art, findings)
        assert any(f.check == "run_decisions.discovery_channels_incomplete" for f in findings), (
            "unreachable channel 0 must NOT exempt; the 4-channel finding should fire"
        )
