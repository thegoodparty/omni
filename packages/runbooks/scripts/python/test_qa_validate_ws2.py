"""WS2 tests — qa-spine routing foundation + P0 check wave.

Covers, all against the GENERIC spine mechanisms (meeting_briefing only
provides the config that drives them):

Foundation
- resolve_output_format: declared type routes; missing/unparseable type routes
  to the strictest type and warns (never silent-skips).
- extract_inline_citations: pulls bracketed citation tokens with spans, honors
  a spec-supplied pattern, returns [] on empty.

Check 1 — high_stakes_structured_match
- extract_literals normalizes money/percentage/vote_count/date/legal/name.
- a high-weight money claim whose figure is absent from the cited source blocks;
  a faithful figure passes.

Check 2 — source_hierarchy_policy
- a claim citing a disallowed source_type for its claim_type is flagged (block
  when high-weight); a claim_type with no policy entry yields a non-blocking
  diagnostic (not block, not silent-allow).

Check 3 — embedding_rescue_blocklist
- a blocklisted claim_type is NOT embedding-rescued (regression);
- a non-blocklisted type with the same low-lexical/high-embedding shape IS
  rescuable (deny-list semantics: absence == not forbidden).

Check 4 — completeness_floor decouple
- exec-summary length is measured from spec-declared field_paths;
- the prior silent-undercount case (featured item present, overview empty) is
  reported as a missing required field, not a silent pass / wrong-reason warn;
- no declared overview paths → skip-with-warning (never silent-skip).

Check 5 — schema_validation (Layer 1)
- a manifest-valid artifact passes; a shape-drifted artifact blocks;
- absent output_format.schema → skip-with-warning;
- diagnostic/skip routes never drive the release verdict (no double-penalty).
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

import qa_validate

HERE = Path(__file__).resolve().parent
SPEC_PATH = HERE / "meeting_briefing_product_spec.json"
FIXTURES = HERE / "fixtures"
MANIFEST_PATH = HERE.parents[1] / "experiments" / "meeting_briefing" / "manifest.json"


@pytest.fixture
def spec() -> dict:
    return qa_validate.load_product_spec(SPEC_PATH)


@pytest.fixture
def spec_no_layer1() -> dict:
    """Spec with Layer-1 schema validation disabled — for unit tests that target a
    single claim/source check with deliberately partial (non-schema-valid)
    artifacts. Layer 1 is exercised separately in the schema_validation tests."""
    s = qa_validate.load_product_spec(SPEC_PATH)
    s["output_format"].pop("schema", None)
    return s


def _find(results, check_id: str):
    return next((r for r in results if r.check_id == check_id), None)


def _all(results, check_id: str):
    return [r for r in results if r.check_id == check_id]


# ── Foundation: output_format routing ─────────────────────────────────────────


def test_resolve_output_format_declared_type(spec):
    of = qa_validate.resolve_output_format(spec)
    assert of["type"] == "structured_json"
    assert of["routes"]["schema_layer1"] is True
    assert of["warnings"] == []
    assert of["defaulted"] is False


def test_resolve_output_format_missing_type_routes_strictest_and_warns():
    of = qa_validate.resolve_output_format({})  # no output_format at all
    assert of["type"] == qa_validate._STRICTEST_OUTPUT_TYPE
    assert of["defaulted"] is True
    assert of["warnings"]  # never silent
    assert of["routes"]["schema_layer1"] is True  # strictest runs schema layer


def test_resolve_output_format_unparseable_type_routes_strictest_and_warns():
    of = qa_validate.resolve_output_format({"output_format": {"type": "yaml_blob"}})
    assert of["type"] == qa_validate._STRICTEST_OUTPUT_TYPE
    assert of["defaulted"] is True
    assert any("unrecognized" in w for w in of["warnings"])


# ── Foundation: inline-citation extractor ─────────────────────────────────────


def test_extract_inline_citations_default_pattern():
    cites = qa_validate.extract_inline_citations("See [src_1] and also [S3] plus [12].")
    tokens = [c["token"] for c in cites]
    assert tokens == ["[src_1]", "[S3]", "[12]"]
    assert cites[0]["ref"] == "1"
    assert cites[0]["start"] == 4


def test_extract_inline_citations_honors_spec_pattern(spec):
    pat = spec["output_format"]["inline_citation_pattern"]
    cites = qa_validate.extract_inline_citations("Grounded in [src_1] per the packet.", pat)
    assert [c["token"] for c in cites] == ["[src_1]"]


def test_extract_inline_citations_empty():
    assert qa_validate.extract_inline_citations("") == []
    assert qa_validate.extract_inline_citations("no citations here") == []


# ── Check 1: structured literal extraction + match ────────────────────────────


@pytest.mark.parametrize(
    "kind,text,expected",
    [
        ("money", "approved $5,000,000 for the project", ["5000000"]),
        ("money", "a $1.8 million grant", ["1800000"]),
        ("percentage", "rose by 12.5%", ["12.5%"]),
        ("vote_count", "passed 4-1 last night", ["4-1"]),
        ("date", "due by 2026-06-01 sharp", ["2026-06-01"]),
        ("legal_citation", "per Ordinance 2024-17", ["ordinance 2024-17"]),
    ],
)
def test_extract_literals_kinds(kind, text, expected):
    assert qa_validate.extract_literals(text, kind) == expected


def test_extract_literals_unknown_kind_empty():
    assert qa_validate.extract_literals("anything $5", "telepathy") == []


def _structured_artifact(claim_text: str, snapshot: str, claim_type="budget_number") -> dict:
    return {
        "official_name": "X", "meeting_date": "2026-06-01", "briefing_type": "council",
        "briefing_status": "briefing_ready",
        "items": [],
        "claims": [{
            "claim_id": "c1", "item_id": "item_001", "claim_type": claim_type,
            "claim_weight": "high", "claim_text": claim_text,
            "source_ids": ["s1"],
            "source_extracts": [{"text": claim_text}],
        }],
        "sources": [{"id": "s1", "source_type": "agenda_packet",
                     "retrieved_text_or_snapshot": snapshot}],
    }


def test_structured_match_known_good(spec_no_layer1):
    art = _structured_artifact(
        "The committee approved a $5,000,000 bond.",
        "Agenda: the committee approved a $5,000,000 bond for the stadium.",
    )
    res = qa_validate.run_deterministic(art, spec_no_layer1)
    chk = _find(res, "high_stakes_structured_match")
    assert chk.status == "pass"


def test_structured_match_known_bad_blocks(spec_no_layer1):
    # claim says $5M, source says $2M — figure absent from cited source → block.
    art = _structured_artifact(
        "The committee approved a $5,000,000 bond.",
        "Agenda: the committee approved a $2,000,000 bond for the stadium.",
    )
    res = qa_validate.run_deterministic(art, spec_no_layer1)
    chk = _find(res, "high_stakes_structured_match")
    assert chk.status == "fail"
    assert chk.route == "block"
    assert "5000000" in chk.offending


# ── Check 2: source-hierarchy policy ──────────────────────────────────────────


def _hierarchy_artifact(claim_type: str, source_type: str) -> dict:
    return {
        "official_name": "X", "meeting_date": "2026-06-01", "briefing_type": "council",
        "briefing_status": "briefing_ready", "items": [],
        "claims": [{
            "claim_id": "c1", "item_id": "item_001", "claim_type": claim_type,
            "claim_weight": "high", "claim_text": "A high-stakes claim.",
            "source_ids": ["s1"], "source_extracts": [{"text": "A high-stakes claim."}],
        }],
        "sources": [{"id": "s1", "source_type": source_type,
                     "retrieved_text_or_snapshot": "A high-stakes claim."}],
    }


def test_source_hierarchy_allowed_passes(spec_no_layer1):
    art = _hierarchy_artifact("budget_number", "agenda_packet")
    chk = _find(qa_validate.run_deterministic(art, spec_no_layer1), "source_hierarchy_policy")
    assert chk.status == "pass"


def test_source_hierarchy_violation_blocks_high_weight(spec_no_layer1):
    # budget_number may only cite agenda_packet/government_website; news is not allowed.
    art = _hierarchy_artifact("budget_number", "news")
    chk = _find(qa_validate.run_deterministic(art, spec_no_layer1), "source_hierarchy_policy")
    assert chk.status == "fail"
    assert chk.route == "block"


def test_source_hierarchy_missing_policy_is_diagnostic_not_block(spec_no_layer1):
    # constituent_priority has no source_hierarchy entry → non-blocking diagnostic.
    art = _hierarchy_artifact("constituent_priority", "news")
    art["claims"][0]["claim_weight"] = "medium"
    chk = _find(qa_validate.run_deterministic(art, spec_no_layer1), "source_hierarchy_policy")
    assert chk.status == "warning"
    assert chk.route == "diagnostic"  # not block, not silent-allow
    assert "constituent_priority" in chk.offending


# ── Check 3: embedding-rescue blocklist ───────────────────────────────────────


def _coherence_results(spec_arg, fixture_name: str):
    art = json.loads((FIXTURES / fixture_name).read_text())
    return qa_validate.run_deterministic(art, spec_arg), art


def test_blocklisted_claim_type_is_not_rescued(spec_no_layer1):
    """Regression: a budget_number claim (blocklisted) must NOT be embedding-rescued
    even when its summary is a faithful low-lexical/high-embedding paraphrase."""
    res, _ = _coherence_results(spec_no_layer1, "ws2_blocklist_no_rescue.json")
    coh = _find(res, "summary_source_coherence")
    assert coh is not None
    per_item = {p["item_id"]: p for p in coh.details["per_item"]}
    item = per_item["item_001"]
    # Sanity: the item is lexically below threshold (the rescue would otherwise fire).
    assert item["below_lexical"] is True
    # The blocklist must refuse the rescue.
    assert item["rescue_forbidden"] is True
    assert "budget_number" in item["rescue_blocked_by_claim_types"]
    assert item["rescued_by_embedding"] is False
    assert item["below_threshold"] is True


def test_non_blocklisted_type_stays_rescuable(spec_no_layer1):
    """Deny-list semantics: a claim_type absent from the blocklist keeps its
    rescue eligibility. Same artifact, claim_type swapped to a non-blocklisted
    type → rescue is no longer forbidden."""
    art = json.loads((FIXTURES / "ws2_blocklist_no_rescue.json").read_text())
    art["claims"][0]["claim_type"] = "background_context"  # not on the blocklist
    res = qa_validate.run_deterministic(art, spec_no_layer1)
    coh = _find(res, "summary_source_coherence")
    item = {p["item_id"]: p for p in coh.details["per_item"]}["item_001"]
    assert item["rescue_forbidden"] is False


# ── Check 4: completeness_floor decouple ──────────────────────────────────────


def test_completeness_reads_spec_declared_paths(spec):
    art = {
        "official_name": "X", "meeting_date": "2026-06-01", "briefing_type": "council",
        "briefing_status": "briefing_ready",
        "executive_summary": {"lead_in": "Y" * 40},
        "items": [{
            "id": "item_001", "item_number": "1", "title": "T", "tier": "featured",
            "vote_required": True, "tier_reason": ["vote_required"],
            "display": {"summary": "S" * 90, "executive_summary_overview": "Z" * 120},
            "research": {"raw_context": [], "full_treatment": None},
        }],
        "claims": [], "sources": [], "required_data_points": [], "disclosure": "d",
    }
    chk = _find(qa_validate.run_deterministic(art, spec), "completeness_floor")
    es = chk.details["executive_summary"]
    assert es["lead_in_chars"] == 40
    assert es["overview_chars"] == 120
    assert es["lead_in_path"] == "executive_summary.lead_in"


def test_completeness_silent_undercount_fixture_reports_missing_field(spec):
    """The prior MB silent-undercount case: featured item present but the
    spec-declared overview field empty. Must surface the missing required field
    rather than silently passing or warning for a length shortfall."""
    art = json.loads((FIXTURES / "ws2_completeness_silent_undercount.json").read_text())
    chk = _find(qa_validate.run_deterministic(art, spec), "completeness_floor")
    assert chk.status == "warning"
    assert "missing or empty" in chk.message
    assert chk.details["executive_summary"]["overview_chars"] == 0


def test_completeness_no_overview_paths_skips_with_warning(spec):
    s = copy.deepcopy(spec)
    s["completeness"]["field_paths"]["exec_summary_overview_paths"] = []
    art = json.loads((FIXTURES / "ws2_completeness_silent_undercount.json").read_text())
    chk = _find(qa_validate.run_deterministic(art, s), "completeness_floor")
    assert chk.status == "warning"
    assert "not measured" in chk.message  # skip-with-warning, never silent-skip


# ── Check 5: Layer-1 schema validation ────────────────────────────────────────


def _valid_full_artifact() -> dict:
    """A minimal manifest-valid (MeetingBriefingFull) artifact. Validated against
    the live manifest output_schema in test_layer1_fixture_is_actually_valid so it
    can't silently drift from the contract."""
    return {
        "experiment_id": "meeting_briefing",
        "briefing_type": "city_council_meeting",
        "briefing_status": "briefing_ready",
        "generated_at": "2026-05-30T00:00:00Z",
        "official_name": "Fixture Official",
        "meeting_name": "Town Council",
        "location": "Town Hall",
        "meeting_date": "2026-06-01",
        "meeting_time": "18:00",
        "meeting_timezone": "America/Chicago",
        "estimated_read_minutes": 5,
        "executive_summary": {
            "lead_in": "The following items on your agenda require action:",
            "items": [
                {"item_id": "item_001", "title": "Stadium Bond", "overview": "A bond vote."}
            ],
        },
        "run_metadata": {"agenda_packet_url": None, "source_bundle_retrieved_at": "2026-05-30T00:00:00Z"},
        "items": [{
            "id": "item_001", "item_number": "1", "title": "Stadium Bond",
            "tier": "featured", "vote_required": True, "tier_reason": ["vote_required"],
            "display": {"summary": "The council will vote on a stadium bond."},
            "research": {
                "raw_context": [{
                    "chunk_id": "chunk_1", "item_id": "item_001",
                    "item_title": "Stadium Bond", "tier": "featured",
                    "source_id": "src_1", "pages": [1],
                    "text": "The committee approved a $5,000,000 bond.",
                }],
                "full_treatment": None,
            },
        }],
        "claims": [{
            "claim_id": "claim_001", "item_id": "item_001", "section": "overview",
            "claim_text": "The committee approved a $5,000,000 bond.",
            "claim_type": "budget_number", "claim_weight": "high",
            "source_extracts": ["The committee approved a $5,000,000 bond."],
            "source_ids": ["src_1"], "required_source_type": "agenda_packet",
            "route_if_unsupported": "block_release",
        }],
        "sources": [{
            "id": "src_1", "name": "Agenda Packet", "source_type": "agenda_packet",
            "retrieved_at": "2026-05-30T00:00:00Z",
            "retrieved_text_or_snapshot": "The committee approved a $5,000,000 bond.",
        }],
        "required_data_points": [],
        "disclosure": "Synthetic fixture.",
    }


def test_layer1_fixture_is_actually_valid():
    """Guard: the happy-path fixture must validate against the live manifest, so
    the Layer-1 pass test below proves real schema conformance, not a stub."""
    jsonschema = pytest.importorskip("jsonschema")
    manifest = json.loads(MANIFEST_PATH.read_text())
    errors = list(jsonschema.Draft7Validator(manifest["output_schema"]).iter_errors(_valid_full_artifact()))
    assert errors == [], errors


def test_layer1_passes_on_valid_artifact(spec):
    pytest.importorskip("jsonschema")
    chk = _find(qa_validate.run_deterministic(_valid_full_artifact(), spec), "schema_validation")
    assert chk.status == "pass"


def test_layer1_blocks_on_shape_drift(spec):
    pytest.importorskip("jsonschema")
    art = _valid_full_artifact()
    art["items"][0]["tier"] = "headline"  # not in the tier enum → shape drift
    chk = _find(qa_validate.run_deterministic(art, spec), "schema_validation")
    assert chk.status == "fail"
    assert chk.route == "block"
    assert chk.details["error_count"] >= 1


def test_layer1_skips_with_warning_when_no_schema_declared(spec):
    s = copy.deepcopy(spec)
    s["output_format"].pop("schema", None)
    chk = _find(qa_validate.run_deterministic(_valid_full_artifact(), s), "schema_validation")
    assert chk.status == "warning"
    assert chk.route == "annotate"  # skip-with-warning, never silent-skip


def test_layer1_runs_first(spec):
    pytest.importorskip("jsonschema")
    res = qa_validate.run_deterministic(_valid_full_artifact(), spec)
    ids = [r.check_id for r in res if r.check_id != "output_format_routing"]
    assert ids[0] == "schema_validation"


# ── No double-penalty / verdict wiring ────────────────────────────────────────


def test_diagnostic_and_skip_routes_do_not_drive_verdict(spec_no_layer1):
    """A source-hierarchy policy gap (diagnostic) and a schema skip-with-warning
    must not, by themselves, escalate the release verdict beyond what the
    underlying findings warrant — diagnostic never counts, annotate is at most a
    warn. Confirms Layer 1 does not double-penalize."""
    art = _hierarchy_artifact("constituent_priority", "news")  # no policy → diagnostic
    art["claims"][0]["claim_weight"] = "medium"
    art["briefing_status"] = "draft"  # avoid the unrelated priority_count block
    res = qa_validate.run_deterministic(art, spec_no_layer1)
    verdict = qa_validate.compute_release_verdict(res, [])
    # diagnostic route must not produce 'block'.
    assert verdict in ("ok", "warn")
    gap = _find(res, "source_hierarchy_policy")
    assert gap.route == "diagnostic"
