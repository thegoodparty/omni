"""WS2 tests — qa-spine routing foundation + P0 check wave.

Covers, all against the GENERIC spine mechanisms (meeting_briefing only
provides the config that drives them):

Foundation
- resolve_output_format: declared type routes; missing/unparseable type routes
  to the strictest type and warns (never silent-skips).
- extract_inline_citations: pulls bracketed citation tokens with spans, honors
  a spec-supplied pattern, returns [] on empty.

Check 1 — numeric_review_flag (detection only)
- detection is high-recall: any high-weight claim that contains a digit is flagged for
  judge numeric review, INCLUDING figures the precise extractors miss ("$.05", a bare
  table value) and numeric claims misclassified into a non-numeric type; "name" claims
  with no figure are not flagged.
- the flagged claim's stated figures are listed verbatim in the judge prompt (phase 1
  AND phase 2), so the judge confirms specific values rather than re-finding numbers.
- the deterministic layer never matches values or blocks on numbers (blocking comes
  only from the judge verdict on high-weight claims).

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


# ── Check 1: numeric-review flag (detection only) + literal extraction ────────


@pytest.mark.parametrize(
    "kind,text,expected",
    [
        # extract_literals returns the surface strings the judge matches against source
        # text — this is what the numeric-review prompt uses to list a claim's figures.
        ("money", "approved $5,000,000 for the project", ["$5,000,000"]),
        ("percentage", "rose by 12.5%", ["12.5%"]),
        ("vote_count", "passed 4-1 last night", ["4-1"]),
        ("date", "due by 2026-06-01 sharp", ["2026-06-01"]),
        ("legal_citation", "per Ordinance 2024-17", ["Ordinance 2024-17"]),
        # Document-structural digit pairs must not be extracted as vote tallies, or a
        # bogus "4-1" would be listed for the judge to verify.
        ("vote_count", "see page 4-1 for details", []),
    ],
)
def test_extract_literals_surface_forms(kind, text, expected):
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


@pytest.mark.parametrize(
    "claim_type,weight,text,expected",
    [
        # high-weight claim stating a figure → flagged, with the raw value listed
        ("budget_number", "high", "approved a $5,000,000 bond", {"money": ["$5,000,000"]}),
        # high-weight claim with no digit → not flagged
        ("budget_number", "high", "approved the bond", {}),
        # not high-weight (non-blockable type, low weight) → not flagged even with a figure
        ("background_context", "low", "roughly $5,000,000 was noted", {}),
        # RECALL: figures the precise extractors miss must still flag AND be listed (via
        # the broad fallback extractor) so the judge verifies the specific value. These
        # are the cases that motivated the branch and that the old detector dropped.
        ("budget_number", "high", "the fee is $.05 per page", {"number": ["$.05"]}),
        ("budget_number", "high", "the table amount is 186,115.00", {"number": ["186,115.00"]}),
        # MIXED formats: a precise match ($5,000,000) must NOT suppress a figure the
        # precise extractor misses ($.05) — both reach the judge's list.
        ("budget_number", "high", "approved $5,000,000 plus a $.05 surcharge",
         {"money": ["$5,000,000"], "number": ["$.05"]}),
        # GAP-DEDUP must be exact-set, not substring: a distinct figure ("1,000") whose
        # digits appear inside a labeled value ("$1,000,000") must still reach the judge.
        ("budget_number", "high", "approved $1,000,000 for 1,000 residents",
         {"money": ["$1,000,000"], "number": ["1,000"]}),
        # finding 2: a numeric claim MISCLASSIFIED into a non-numeric, non-blockable type
        # is still flagged when high-weight — detection does not trust claim_type.
        ("background_context", "high", "approved a $5,000,000 bond", {"money": ["$5,000,000"]}),
        # finding 3: a name claim with no figure is NOT flagged (name is excluded from
        # the numeric flag; proper-noun review is a separate follow-up).
        ("named_person_or_role", "high", "Mayor Michael Brown will vote", {}),
    ],
)
def test_flag_numeric_review(spec_no_layer1, claim_type, weight, text, expected):
    blockable = qa_validate.blockable_types(spec_no_layer1)
    claim = {"claim_type": claim_type, "claim_weight": weight, "claim_text": text}
    assert qa_validate.flag_numeric_review(claim, blockable) == expected


def test_numeric_instruction_generic_fallback_lists_values_without_kind(spec_no_layer1):
    # The generic ("number") fallback still lists the figure but omits the "(detected: …)"
    # kind label — the branch the money-classified phase1/phase2 tests never exercise.
    instr = qa_validate._numeric_review_instruction({"number": ["$.05"]})
    assert "NUMERIC REVIEW REQUIRED" in instr
    assert "$.05" in instr
    assert "(detected:" not in instr


def _blocking_ids(res) -> set:
    return {c.check_id for c in res if c.route == "block" and c.status == "fail"}


def test_numeric_mismatch_adds_no_deterministic_block(spec_no_layer1):
    # The old design hard-blocked when the figure was absent from the source. Now the
    # deterministic layer never matches values, so changing the cited figure from a
    # match ($5M/$5M) to a mismatch ($5M/$2M) must change the deterministic block set
    # by nothing — the figure is the judge's job. (Other incidental blocks from this
    # minimal fixture are identical across both and irrelevant here.)
    matched = qa_validate.run_deterministic(
        _structured_artifact("Approved a $5,000,000 bond.", "Agenda: approved a $5,000,000 bond."),
        spec_no_layer1,
    )
    mismatch = qa_validate.run_deterministic(
        _structured_artifact("Approved a $5,000,000 bond.", "Agenda: approved a $2,000,000 bond."),
        spec_no_layer1,
    )
    assert _blocking_ids(matched) == _blocking_ids(mismatch)
    chk = _find(mismatch, "numeric_review_flag")
    assert chk.route == "diagnostic"
    assert chk.status == "pass"  # diagnostic must not masquerade as a fail
    assert chk.details["flagged_count"] == 1
    # the diagnostic surfaces the actual figure an operator would read
    assert chk.details["flagged"][0]["values"] == ["$5,000,000"]
    assert _find(mismatch, "high_stakes_structured_match") is None


def test_numeric_review_flag_diagnostic_emitted_without_structured_validators(spec_no_layer1):
    # The flag no longer reads structured_validators, so the bundle diagnostic must still
    # appear when a spec omits that config — otherwise the prompt could get the numeric
    # instruction while the audit record silently drops it.
    spec = copy.deepcopy(spec_no_layer1)
    spec.pop("structured_validators", None)
    res = qa_validate.run_deterministic(
        _structured_artifact("Approved a $5,000,000 bond.", "Agenda: approved a $5,000,000 bond."),
        spec,
    )
    chk = _find(res, "numeric_review_flag")
    assert chk is not None and chk.route == "diagnostic"
    assert chk.details["flagged"][0]["values"] == ["$5,000,000"]


class _StubJudge:
    """A judge that records the prompt it receives and returns a fixed verdict.
    Lets us test prompt steering and the escalation/verdict path with no LLM spend."""
    name = "stub"

    def __init__(self, category: str = "Accurate"):
        self._category = category
        self.prompts: list[str] = []

    def adjudicate(self, claim, system_prompt, source_passage="", prior=None):
        self.prompts.append(source_passage)
        return qa_validate._AdjudicationOutput(accuracy_category=self._category, reasoning="stub")


def _numeric_claim(text: str, claim_type="budget_number", weight="high") -> list[dict]:
    return [{
        "claim_id": "c1", "claim_type": claim_type, "claim_weight": weight,
        "claim_text": text, "source_ids": ["s1"],
        "source_extracts": [{"text": text}],
    }]


def test_phase1_appends_numeric_instruction_for_flagged_claim(spec_no_layer1):
    blockable = qa_validate.blockable_types(spec_no_layer1)
    ok_cats = qa_validate.ok_categories(spec_no_layer1)
    judge = _StubJudge()
    qa_validate.phase1_triage(
        _numeric_claim("Approved a $5,000,000 bond."), judge, ok_cats, blockable
    )
    assert "NUMERIC REVIEW REQUIRED" in judge.prompts[0]
    # the actual figure is listed so the judge confirms it rather than re-finding it
    assert "$5,000,000" in judge.prompts[0]


def test_phase1_omits_numeric_instruction_for_non_numeric_claim(spec_no_layer1):
    blockable = qa_validate.blockable_types(spec_no_layer1)
    ok_cats = qa_validate.ok_categories(spec_no_layer1)
    judge = _StubJudge()
    qa_validate.phase1_triage(
        _numeric_claim("The committee approved the bond."), judge, ok_cats, blockable
    )
    assert "NUMERIC REVIEW REQUIRED" not in judge.prompts[0]


def test_flagged_claim_blocks_only_via_judge_verdict(spec_no_layer1):
    # End to end with a stub judge (no spend): a flagged high-weight claim that the
    # judge marks not-OK escalates and produces a block release verdict. Blocking comes
    # from the judge, not the deterministic layer.
    claims = _numeric_claim("Approved a $5,000,000 bond.")
    sources = [{"id": "s1", "source_type": "agenda_packet",
                "retrieved_text_or_snapshot": "approved a $2,000,000 bond"}]
    blockable = qa_validate.blockable_types(spec_no_layer1)
    ok_cats = qa_validate.ok_categories(spec_no_layer1)
    judge = _StubJudge(category="Incorrect")  # not-OK

    p1 = qa_validate.phase1_triage(claims, judge, ok_cats, blockable)
    traces = [qa_validate.ClaimTrace(claim=claims[0])]
    traces[0].phase1 = p1[0]
    qa_validate.phase2_escalate(traces, sources, judge, blockable, ok_cats, {"sources": sources})
    # pin that the block came from phase 2 escalating, not an accidental fall-through
    assert traces[0].phase2 is not None and not traces[0].phase2.is_ok
    assert qa_validate.compute_release_verdict([], traces) == "block"


def test_phase2_appends_numeric_instruction_for_flagged_claim(spec_no_layer1):
    # Phase 2 is where the block decision is made, so the explicit figure list must reach
    # the escalation judge too — not only phase 1.
    claims = _numeric_claim("Approved a $5,000,000 bond.")
    sources = [{"id": "s1", "source_type": "agenda_packet",
                "retrieved_text_or_snapshot": "approved a $2,000,000 bond"}]
    blockable = qa_validate.blockable_types(spec_no_layer1)
    ok_cats = qa_validate.ok_categories(spec_no_layer1)
    judge = _StubJudge(category="Incorrect")  # not-OK → escalation runs and records its prompt
    traces = [qa_validate.ClaimTrace(claim=claims[0])]
    traces[0].phase1 = qa_validate.Phase1Result(
        claim_id="c1", accuracy_category="Incorrect", reasoning="stub", is_ok=False
    )
    qa_validate.phase2_escalate(traces, sources, judge, blockable, ok_cats, {"sources": sources})
    assert "NUMERIC REVIEW REQUIRED" in judge.prompts[0]
    assert "$5,000,000" in judge.prompts[0]


# ── Fail-open guard: high-weight claims unadjudicated ─────────────────────────
# The numeric flag steers a judge instead of blocking deterministically, so the
# verdict now depends on the judge running. This general guard (not numeric-only)
# blocks rather than silently passing high-weight claims when a judge was expected
# but did not run.

def _weighted_trace(claim_type: str, weight: str, phase1_is_ok):
    """A ClaimTrace; phase1_is_ok=None means the claim was never adjudicated."""
    claim = {"claim_id": f"{claim_type}_{weight}", "claim_type": claim_type, "claim_weight": weight}
    t = qa_validate.ClaimTrace(claim=claim)
    if phase1_is_ok is not None:
        t.phase1 = qa_validate.Phase1Result(
            claim_id=claim["claim_id"], accuracy_category="Accurate", reasoning="x", is_ok=phase1_is_ok
        )
    return t


def test_unadjudicated_guard_blocks_when_judge_expected_but_absent(spec_no_layer1):
    blockable = qa_validate.blockable_types(spec_no_layer1)
    traces = [_weighted_trace("budget_number", "high", None)]
    chk = qa_validate.check_high_weight_unadjudicated(traces, blockable, llm_expected=True)
    assert chk is not None and chk.route == "block" and chk.status == "fail"
    assert chk.details["unadjudicated_count"] == 1


def test_unadjudicated_guard_silent_when_llm_not_expected(spec_no_layer1):
    # --no-llm or no judge configured → unreviewed is intentional, do not block.
    blockable = qa_validate.blockable_types(spec_no_layer1)
    traces = [_weighted_trace("budget_number", "high", None)]
    assert qa_validate.check_high_weight_unadjudicated(traces, blockable, llm_expected=False) is None


def test_unadjudicated_guard_silent_when_high_weight_claims_reviewed(spec_no_layer1):
    # High-weight claim adjudicated; a low-weight unadjudicated claim is not the guard's concern.
    blockable = qa_validate.blockable_types(spec_no_layer1)
    traces = [_weighted_trace("budget_number", "high", True),
              _weighted_trace("background_context", "low", None)]
    assert qa_validate.check_high_weight_unadjudicated(traces, blockable, llm_expected=True) is None


def test_unadjudicated_guard_blocks_when_phase2_expected_but_absent(spec_no_layer1):
    # Phase 1 flagged a high-weight claim not-OK, but Phase 2 — where the block decision is
    # made — never ran (judge unavailable). Without this the verdict downgrades to warn.
    blockable = qa_validate.blockable_types(spec_no_layer1)
    traces = [_weighted_trace("budget_number", "high", False)]  # phase1 not-OK, phase2 None
    chk = qa_validate.check_high_weight_unadjudicated(
        traces, blockable, llm_expected=True, p2_expected=True
    )
    assert chk is not None and chk.route == "block"


def test_unadjudicated_guard_silent_on_phase2_gap_when_p2_not_expected(spec_no_layer1):
    # Backwards compat: with p2_expected defaulting False, a not-OK Phase 1 claim whose
    # Phase 2 did not run is not flagged (e.g. no phase2 judge configured).
    blockable = qa_validate.blockable_types(spec_no_layer1)
    traces = [_weighted_trace("budget_number", "high", False)]
    assert qa_validate.check_high_weight_unadjudicated(traces, blockable, llm_expected=True) is None


def test_unadjudicated_guard_silent_when_phase2_completed(spec_no_layer1):
    # Phase 2 produced a verdict → the normal block path owns it, not this guard.
    blockable = qa_validate.blockable_types(spec_no_layer1)
    t = _weighted_trace("budget_number", "high", False)
    t.phase2 = qa_validate.Phase2Result(
        claim_id="budget_number_high", accuracy_category="Incorrect",
        reasoning="x", is_ok=False, proposed_correction=None,
    )
    assert qa_validate.check_high_weight_unadjudicated(
        [t], blockable, llm_expected=True, p2_expected=True
    ) is None


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


def test_source_hierarchy_other_fail_and_gap_co_occur(spec_no_layer1):
    """When an artifact has BOTH a non-high-weight source-type violation AND an
    unpolicied claim_type, the annotate result and the diagnostic result must each
    be emitted separately — the gap diagnostic must not be suppressed by the
    other-fail branch.

    Defensive branch: in the shipped spec every claim_type with a
    source_hierarchy entry (budget_number, vote_count, legal_citation,
    date_or_deadline) is also blockable, so _is_high_weight() forces them
    high-weight and the sh_other_fail (annotate) branch is UNREACHABLE via the
    real spec. To exercise the annotate-vs-diagnostic co-occurrence we deepcopy
    the spec and mark legal_citation non-blockable FOR THIS TEST ONLY, leaving
    production behavior unchanged."""
    spec_no_layer1 = copy.deepcopy(spec_no_layer1)
    spec_no_layer1["claim_types"]["legal_citation"]["blockable"] = False
    art = {
        "official_name": "X", "meeting_date": "2026-06-01", "briefing_type": "council",
        "briefing_status": "briefing_ready", "items": [],
        "claims": [
            {
                # policied type (legal_citation →
                # agenda_packet/government_website), made non-blockable for this
                # test via the deepcopy above, citing 'news' at non-high weight
                # → other-fail (annotate, not block).
                "claim_id": "c1", "item_id": "item_001", "claim_type": "legal_citation",
                "claim_weight": "medium", "claim_text": "A legal claim.",
                "source_ids": ["s1"], "source_extracts": [{"text": "A legal claim."}],
            },
            {
                # unpolicied type → gap (diagnostic).
                "claim_id": "c2", "item_id": "item_001", "claim_type": "constituent_priority",
                "claim_weight": "medium", "claim_text": "A priority claim.",
                "source_ids": ["s2"], "source_extracts": [{"text": "A priority claim."}],
            },
        ],
        "sources": [
            {"id": "s1", "source_type": "news", "retrieved_text_or_snapshot": "A legal claim."},
            {"id": "s2", "source_type": "news", "retrieved_text_or_snapshot": "A priority claim."},
        ],
    }
    res = qa_validate.run_deterministic(art, spec_no_layer1)
    sh = _all(res, "source_hierarchy_policy")
    routes = {r.route for r in sh}
    assert "annotate" in routes  # the non-high-weight violation surfaces
    assert "diagnostic" in routes  # the policy gap surfaces on its own result
    diag = next(r for r in sh if r.route == "diagnostic")
    assert "constituent_priority" in diag.offending


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
    # The positive rescue path only exists when the embedding model can load;
    # without it emb_cos is None and the rescue can never fire, which would make
    # a bare rescue_forbidden assertion vacuously pass. Skip cleanly instead.
    pytest.importorskip("sentence_transformers")
    art = json.loads((FIXTURES / "ws2_blocklist_no_rescue.json").read_text())
    art["claims"][0]["claim_type"] = "background_context"  # not on the blocklist
    # The fixture summary is a faithful low-lexical paraphrase; its real MiniLM
    # embedding cosine (~0.44) clears a rescue threshold set just below it. Lower
    # the threshold so the actual model output drives the rescue — proving the
    # positive path engages, not just that the type is rescuable on paper.
    spec = copy.deepcopy(spec_no_layer1)
    spec["embedding_check"]["rescue_threshold"] = 0.40
    res = qa_validate.run_deterministic(art, spec)
    coh = _find(res, "summary_source_coherence")
    item = {p["item_id"]: p for p in coh.details["per_item"]}["item_001"]
    assert item["rescue_forbidden"] is False
    # Prove the positive path actually fired with the model present.
    assert item["below_lexical"] is True
    assert item["embedding_cosine"] is not None
    assert item["rescued_by_embedding"] is True
    assert item["below_threshold"] is False


# ── Check 4: completeness_floor decouple ──────────────────────────────────────


def test_completeness_reads_spec_declared_paths(spec):
    art = {
        "official_name": "X", "meeting_date": "2026-06-01", "briefing_type": "council",
        "briefing_status": "briefing_ready",
        "executive_summary": {
            "lead_in": "Y" * 40,
            "items": [{"item_id": "item_001", "title": "T", "overview": "Z" * 120}],
        },
        "items": [{
            "id": "item_001", "item_number": "1", "title": "T", "tier": "featured",
            "vote_required": True, "tier_reason": ["vote_required"],
            "display": {"summary": "S" * 90},
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
        "run_metadata": {
            "agenda_packet_url": None,
            "source_bundle_retrieved_at": "2026-05-30T00:00:00Z",
            "discovered_agenda_location": None,
        },
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


def test_layer1_annotates_on_shape_drift(spec):
    # Staged as annotate (warning), not block, during the initial trial window so
    # shape drift does not retroactively fail previously-passing briefings.
    pytest.importorskip("jsonschema")
    art = _valid_full_artifact()
    art["items"][0]["tier"] = "headline"  # not in the tier enum → shape drift
    chk = _find(qa_validate.run_deterministic(art, spec), "schema_validation")
    assert chk.status == "fail"
    assert chk.route == "annotate"
    assert chk.details["error_count"] >= 1


def test_layer1_skips_with_warning_when_no_schema_declared(spec):
    s = copy.deepcopy(spec)
    s["output_format"].pop("schema", None)
    chk = _find(qa_validate.run_deterministic(_valid_full_artifact(), s), "schema_validation")
    assert chk.status == "warning"
    assert chk.route == "annotate"  # skip-with-warning, never silent-skip


def test_layer1_skips_with_warning_when_manifest_not_found(spec):
    # Fail-open branch: declared manifest path resolves nowhere → warn, not crash.
    s = copy.deepcopy(spec)
    s["output_format"]["schema"]["manifest_path"] = "experiments/meeting_briefing/__does_not_exist__.json"
    chk = _find(qa_validate.run_deterministic(_valid_full_artifact(), s), "schema_validation")
    assert chk.status == "warning"
    assert chk.route == "annotate"
    assert chk.details["reason"] == "manifest_not_found"


def test_layer1_skips_with_warning_when_schema_unreadable(spec):
    # Fail-open branch: manifest loads but the schema_key is absent → warn, not crash.
    s = copy.deepcopy(spec)
    s["output_format"]["schema"]["schema_key"] = "__no_such_key__"
    chk = _find(qa_validate.run_deterministic(_valid_full_artifact(), s), "schema_validation")
    assert chk.status == "warning"
    assert chk.route == "annotate"
    assert chk.details["reason"] == "schema_unreadable"


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
