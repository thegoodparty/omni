"""Tests for qa_validate.py deterministic checks against the flattened
executive_summary shape (manifest v5+).

The executive summary is an object whose per-featured-item overviews live
inline at executive_summary.items[].overview (NOT on items[].display):

    executive_summary = {
        "lead_in": "...",
        "items": [{"item_id": "item_001", "title": "...", "overview": "..."}, ...]
    }

Each agenda item under items[] carries its EO-facing prose at display.summary
and is featured when tier == "featured".

Coverage:
- _values_at_path resolves executive_summary.items[].overview and lead_in.
- completeness_floor sums lead_in + the exec-summary item overviews, warns on a
  length shortfall, and reports a missing/empty required field when featured
  items exist but executive_summary.items is empty.
- _iter_polish_prose yields lead_in plus each exec-summary item overview as a
  separate path, and skips overviews that are None.
- claim_coverage flags featured items with prose but too few claims.
- diagnostic-routed checks never change the release verdict.
- doubled_word regex tolerates hyphenated compounds ("in in-kind") but catches
  true doubles ("enforcement enforcement").
- a clean synthetic artifact returns no block / no false warnings.
- the known-bad fixture blocks via extracts_appear_in_cited_source.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

import qa_validate

SPEC_PATH = Path(__file__).resolve().parent / "meeting_briefing_product_spec.json"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def spec() -> dict:
    return json.loads(SPEC_PATH.read_text())


def _exec_item(idx: int, title: str, *, overview: str = "Some featured overview.") -> dict:
    """An entry in the flattened executive_summary.items[] array."""
    return {"item_id": f"item_{idx:03d}", "title": title, "overview": overview}


def _featured_item(
    idx: int,
    title: str,
    *,
    summary: str = "Some featured summary.",
    claims=None,
) -> dict:
    """An agenda item under items[]; featured carries display.summary."""
    item = {
        "id": f"item_{idx:03d}",
        "item_number": str(idx),
        "title": title,
        "tier": "featured",
        "vote_required": True,
        "tier_reason": ["vote_required"],
        "display": {"summary": summary},
        "research": {
            "raw_context": [
                {
                    "chunk_id": f"chunk_{idx:03d}",
                    "item_id": f"item_{idx:03d}",
                    "item_title": title,
                    "tier": "featured",
                    "source_id": "src_1",
                    "pages": [1],
                    "text": "Source context for the item.",
                }
            ],
            "full_treatment": None,
        },
    }
    return item


def _base_artifact(
    *,
    featured_titles=None,
    featured_overviews=None,
    featured_summaries=None,
    lead_in="The following items require action:",
    include_exec_items=True,
) -> dict:
    """Build a flattened-shape artifact.

    items[] gets a featured agenda item per title; executive_summary.items[]
    mirrors them with an inline overview (unless include_exec_items=False, which
    leaves executive_summary.items empty to exercise the missing-field branch).
    """
    featured_titles = featured_titles or []
    featured_overviews = featured_overviews or ["Some featured overview." for _ in featured_titles]
    featured_summaries = featured_summaries or ["Some featured summary." for _ in featured_titles]

    items = [
        _featured_item(i, t, summary=s)
        for i, (t, s) in enumerate(zip(featured_titles, featured_summaries), start=1)
    ]
    exec_items = []
    if include_exec_items:
        exec_items = [
            _exec_item(i, t, overview=o)
            for i, (t, o) in enumerate(zip(featured_titles, featured_overviews), start=1)
        ]

    return {
        "experiment_id": "meeting_briefing",
        "briefing_type": "city_council_meeting",
        "briefing_status": "briefing_ready",
        "generated_at": "2026-05-26T00:00:00Z",
        "official_name": "Test Official",
        "meeting_name": "City Council",
        "location": "City Hall",
        "meeting_date": "2026-06-01",
        "meeting_time": "19:00",
        "meeting_timezone": "America/Chicago",
        "estimated_read_minutes": 5,
        "executive_summary": {"lead_in": lead_in, "items": exec_items},
        "run_metadata": {
            "agenda_packet_url": None,
            "source_bundle_retrieved_at": "2026-05-26T00:00:00Z",
            "discovered_agenda_location": None,
        },
        "items": items,
        "claims": [],
        "sources": [],
        "required_data_points": [],
        "disclosure": "Disclaimer.",
    }


def _find(results, check_id: str):
    for r in results:
        if r.check_id == check_id:
            return r
    return None


# ── _values_at_path ──────────────────────────────────────────────────────────


def test_values_at_path_resolves_exec_summary_item_overviews():
    artifact = {
        "executive_summary": {
            "items": [
                {"item_id": "item_001", "overview": "First."},
                {"item_id": "item_002", "overview": "Second."},
            ]
        }
    }
    assert qa_validate._values_at_path(
        artifact, "executive_summary.items[].overview"
    ) == ["First.", "Second."]


def test_values_at_path_resolves_lead_in():
    artifact = {"executive_summary": {"lead_in": "Lead text."}}
    assert qa_validate._values_at_path(artifact, "executive_summary.lead_in") == ["Lead text."]


def test_values_at_path_returns_empty_for_wrong_shape():
    legacy = {"executive_summary": "legacy string form"}
    assert qa_validate._values_at_path(legacy, "executive_summary.lead_in") == []
    assert qa_validate._values_at_path(legacy, "executive_summary.items[].overview") == []


# ── completeness_floor exec_summary measurement ──────────────────────────────


def test_completeness_floor_sums_lead_in_and_overviews(spec):
    spec["completeness"]["min_executive_summary_chars"] = 50
    artifact = _base_artifact(
        featured_titles=["A"],
        featured_overviews=["X" * 100],
        lead_in="Y" * 30,
    )
    results = qa_validate.run_deterministic(artifact, spec)
    comp = _find(results, "completeness_floor")
    assert comp is not None
    measured = comp.details["executive_summary"]
    assert measured["lead_in_chars"] == 30
    assert measured["overview_chars"] == 100
    assert measured["chars"] == 130
    assert measured["overview_paths"] == ["executive_summary.items[].overview"]
    assert measured["overview_count"] == 1


def test_completeness_floor_warns_when_exec_summary_below_min(spec):
    spec["completeness"]["min_executive_summary_chars"] = 250
    artifact = _base_artifact(
        featured_titles=["Short"],
        featured_overviews=["tiny"],
        lead_in="Brief lead.",
    )
    results = qa_validate.run_deterministic(artifact, spec)
    comp = _find(results, "completeness_floor")
    assert comp is not None
    assert comp.status == "warning"
    assert "executive_summary" in comp.message
    # length-shortfall branch, not the missing-field branch
    assert "required field missing" not in comp.message


def test_completeness_floor_reports_missing_overview_field_when_featured_present(spec):
    """Featured items exist but executive_summary.items resolves to nothing →
    that is a missing/empty required field, not a length shortfall."""
    artifact = _base_artifact(
        featured_titles=["A"],
        lead_in="Y" * 400,  # long enough that a length check would pass
        include_exec_items=False,
    )
    results = qa_validate.run_deterministic(artifact, spec)
    comp = _find(results, "completeness_floor")
    assert comp is not None
    assert comp.status == "warning"
    assert "required exec-summary overview missing or empty" in comp.message
    assert "executive_summary.items[].overview" in comp.message
    assert comp.details["executive_summary"]["overview_count"] == 0


# ── _iter_polish_prose ───────────────────────────────────────────────────────


def test_iter_polish_prose_yields_lead_in_and_exec_item_overviews():
    artifact = _base_artifact(
        featured_titles=["Foo"],
        featured_overviews=["A featured overview sentence."],
        lead_in="Lead sentence.",
    )
    paths = dict(qa_validate._iter_polish_prose(artifact))
    assert paths.get("$.executive_summary.lead_in") == "Lead sentence."
    assert paths.get("$.executive_summary.items[item_001].overview") == "A featured overview sentence."


def test_iter_polish_prose_skips_null_overview():
    artifact = _base_artifact(featured_titles=["A"])
    artifact["executive_summary"]["items"][0]["overview"] = None
    paths = dict(qa_validate._iter_polish_prose(artifact))
    assert "$.executive_summary.items[item_001].overview" not in paths


# ── Layer A: template-expanded prohibited_phrases ────────────────────────────


def test_prohibited_phrases_expands_template_against_artifact_value(spec):
    """Pattern with {{candidate_name}} must resolve against artifact[candidate_name]."""
    spec["prohibited_phrases"] = [{"name": "candidate_by_name", "pattern": "\\b{{candidate_name}}\\b"}]
    spec["prohibited_phrase_paths"] = ["items[].display.summary"]
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["candidate_name"] = "Maya Alvarez"
    artifact["items"][0]["display"]["summary"] = "As Maya Alvarez has demonstrated, the race is winnable."
    results = qa_validate.run_deterministic(artifact, spec)
    phrase = _find(results, "prohibited_phrases")
    assert phrase.status == "warning"
    assert "candidate_by_name" in phrase.offending


def test_prohibited_phrases_skips_pattern_when_artifact_field_missing(spec):
    """Missing key → pattern skipped, recorded in details.skipped_patterns, no false match."""
    spec["prohibited_phrases"] = [{"name": "candidate_by_name", "pattern": "\\b{{candidate_name}}\\b"}]
    spec["prohibited_phrase_paths"] = ["items[].display.summary"]
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["items"][0]["display"]["summary"] = "Some prose with no name."
    # NOTE: artifact has no top-level candidate_name field
    results = qa_validate.run_deterministic(artifact, spec)
    phrase = _find(results, "prohibited_phrases")
    assert phrase.status == "pass"
    skipped = phrase.details["skipped_patterns"]
    assert len(skipped) == 1
    assert skipped[0]["name"] == "candidate_by_name"
    assert skipped[0]["missing_keys"] == ["candidate_name"]


def test_prohibited_phrases_template_escapes_regex_special_chars(spec):
    """A candidate name with regex-special chars (e.g. parentheses) must not break the regex."""
    spec["prohibited_phrases"] = [{"name": "candidate_by_name", "pattern": "\\b{{candidate_name}}\\b"}]
    spec["prohibited_phrase_paths"] = ["items[].display.summary"]
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["candidate_name"] = "Maya (Maya) Alvarez"  # parens would explode an unescaped regex
    artifact["items"][0]["display"]["summary"] = "Maya (Maya) Alvarez ran a strong race."
    results = qa_validate.run_deterministic(artifact, spec)
    phrase = _find(results, "prohibited_phrases")
    assert phrase.status == "warning"


# ── Layer A: citation_label_url_coherence ────────────────────────────────────


def test_citation_label_url_coherence_self_skips_when_paths_empty(spec):
    spec["citation_paths"] = []
    spec["label_domain_map"] = {"Wikipedia": ["wikipedia.org"]}
    artifact = _base_artifact(featured_titles=["Foo"])
    results = qa_validate.run_deterministic(artifact, spec)
    assert _find(results, "citation_label_url_coherence") is None


def test_citation_label_url_coherence_flags_mismatch_case_insensitive(spec):
    spec["citation_paths"] = ["items[].display.summary"]
    spec["label_domain_map"] = {"Wikipedia": ["wikipedia.org"]}
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["items"][0]["display"]["summary"] = (
        "Per the official record [wikipedia entry](https://www.nytimes.com/article)."
    )
    results = qa_validate.run_deterministic(artifact, spec)
    coh = _find(results, "citation_label_url_coherence")
    assert coh.status == "warning"
    assert len(coh.details["mismatches"]) == 1
    assert coh.details["mismatches"][0]["host"] == "nytimes.com"


def test_citation_label_url_coherence_accepts_subdomain_suffix(spec):
    spec["citation_paths"] = ["items[].display.summary"]
    spec["label_domain_map"] = {"Wikipedia": ["wikipedia.org"]}
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["items"][0]["display"]["summary"] = (
        "Background [Wikipedia](https://en.wikipedia.org/wiki/Page) on the topic."
    )
    results = qa_validate.run_deterministic(artifact, spec)
    coh = _find(results, "citation_label_url_coherence")
    assert coh.status == "pass"


# ── Layer A: social_media_citation ───────────────────────────────────────────


def test_social_media_citation_warns_on_facebook_url(spec):
    spec["citation_paths"] = ["items[].display.summary"]
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["items"][0]["display"]["summary"] = (
        "Per their campaign [Facebook](https://www.facebook.com/SomeCampaign/) page."
    )
    results = qa_validate.run_deterministic(artifact, spec)
    social = _find(results, "social_media_citation")
    assert social.status == "warning"
    assert social.details["findings"][0]["host"] == "facebook.com"


# ── Layer A: urls_resolve gating ─────────────────────────────────────────────


def test_urls_resolve_self_skips_when_check_urls_flag_off(spec):
    """The URL liveness check must not register a finding when the CLI flag is off,
    even with a spec that has url_check.enabled and a populated citation_paths."""
    spec["citation_paths"] = ["items[].display.summary"]
    spec["url_check"] = {"enabled": True}
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["items"][0]["display"]["summary"] = "[Example](https://example.com/) page."
    results = qa_validate.run_deterministic(artifact, spec, check_urls=False)
    assert _find(results, "urls_resolve") is None


def test_urls_resolve_force_flag_overrides_disabled_spec(spec, monkeypatch):
    """check_urls=True (the --check-urls force-on override) runs the check even
    when spec.url_check.enabled is false. Network is stubbed offline."""
    monkeypatch.setattr(
        qa_validate.socket, "getaddrinfo",
        lambda host, port: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )

    class _Resp:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *a): return False

    class _Opener:
        def open(self, req, timeout=None): return _Resp()

    monkeypatch.setattr(qa_validate.urllib.request, "build_opener", lambda *a, **k: _Opener())
    spec["citation_paths"] = ["items[].display.summary"]
    spec["url_check"] = {"enabled": False}
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["items"][0]["display"]["summary"] = "[Example](https://example.com/) page."
    results = qa_validate.run_deterministic(artifact, spec, check_urls=True)
    assert _find(results, "urls_resolve") is not None


# ── claim_coverage ───────────────────────────────────────────────────────────


def _coverage_claim(claim_id: str, item_id: str) -> dict:
    return {
        "claim_id": claim_id,
        "item_id": item_id,
        "claim_type": "background_context",
        "claim_weight": "medium",
        "claim_text": "Background.",
        "source_ids": ["src_1"],
        "source_extracts": [{"text": "Background detail.", "extract_type": "quote"}],
    }


def test_claim_coverage_flags_featured_item_with_prose_but_no_claims(spec):
    artifact = _base_artifact(featured_titles=["A"])
    # no claims at all
    artifact["claims"] = []
    results = qa_validate.run_deterministic(artifact, spec)
    cov = _find(results, "claim_coverage")
    assert cov is not None
    assert cov.route == "diagnostic"
    assert cov.status == "warning"
    assert cov.details["below_count"] == 1


def test_claim_coverage_does_not_flag_item_with_enough_claims(spec):
    # cutoff is 2; give item_001 two claims
    artifact = _base_artifact(featured_titles=["A"])
    artifact["claims"] = [
        _coverage_claim("claim_001", "item_001"),
        _coverage_claim("claim_002", "item_001"),
    ]
    results = qa_validate.run_deterministic(artifact, spec)
    cov = _find(results, "claim_coverage")
    assert cov is not None
    assert cov.route == "diagnostic"
    assert cov.status == "pass"
    assert cov.details["below_count"] == 0


def test_claim_coverage_does_not_flag_item_with_empty_summary(spec):
    artifact = _base_artifact(featured_titles=["A"], featured_summaries=[""])
    artifact["claims"] = []  # zero claims, but no prose either
    results = qa_validate.run_deterministic(artifact, spec)
    cov = _find(results, "claim_coverage")
    assert cov is not None
    assert cov.status == "pass"
    assert cov.details["below_count"] == 0


# ── diagnostic route never moves the verdict ─────────────────────────────────


def test_diagnostic_route_does_not_affect_verdict(spec):
    """A clean artifact whose only non-pass deterministic findings are
    diagnostic (claim_coverage / coherence) must still verdict 'ok'."""
    # Make completeness trivially satisfiable so it cannot warn. Lower the
    # thresholds in place rather than replacing the dict, so the spec-declared
    # field_paths (which the completeness check walks to measure prose) survive.
    spec["completeness"].update({
        "min_priority_items": 1,
        "min_executive_summary_chars": 1,
        "min_overview_chars_per_priority_item": 1,
        "min_total_prose_words": 1,
    })
    spec["embedding_check"]["enabled"] = False
    artifact = _base_artifact(
        featured_titles=["A"],
        featured_overviews=["A reasonably substantive featured overview goes here."],
        featured_summaries=["A reasonably substantive featured summary sentence goes here."],
        lead_in="A reasonably substantive lead-in sentence for the briefing.",
    )
    artifact["claims"] = []  # zero claims → claim_coverage fires as diagnostic
    results = qa_validate.run_deterministic(artifact, spec)

    cov = _find(results, "claim_coverage")
    assert cov is not None and cov.route == "diagnostic" and cov.status == "warning"
    # No annotate/block-routed warning or failure should be present.
    assert not [
        r for r in results
        if r.route in ("annotate", "block") and r.status in ("warning", "fail")
    ]
    assert qa_validate.compute_release_verdict(results, []) == "ok"


# ── doubled_word polish pattern ──────────────────────────────────────────────


def _doubled_word_pattern(spec: dict) -> str:
    for entry in spec["polish_patterns"]:
        if entry["name"] == "doubled_word":
            return entry["pattern"]
    raise AssertionError("doubled_word pattern not found in spec")


def test_doubled_word_ignores_hyphenated_compound(spec):
    pattern = _doubled_word_pattern(spec)
    assert re.search(pattern, "providing in in-kind support", re.IGNORECASE) is None


def test_doubled_word_catches_true_double(spec):
    pattern = _doubled_word_pattern(spec)
    assert re.search(pattern, "strict enforcement enforcement action", re.IGNORECASE) is not None


def test_doubled_word_end_to_end(spec):
    """Through run_deterministic: a hyphenated compound produces no doubled_word
    finding; a true double does."""
    clean = _base_artifact(
        featured_titles=["A"],
        featured_summaries=["The city is providing in in-kind support to the program."],
    )
    polish = _find(qa_validate.run_deterministic(clean, spec), "polish_grammar")
    assert polish is not None
    assert not [f for f in polish.details["findings"] if f["pattern_name"] == "doubled_word"]

    dirty = _base_artifact(
        featured_titles=["A"],
        featured_summaries=["The council took strict enforcement enforcement action."],
    )
    polish = _find(qa_validate.run_deterministic(dirty, spec), "polish_grammar")
    assert polish is not None
    assert [f for f in polish.details["findings"] if f["pattern_name"] == "doubled_word"]


# ── known-good: a clean artifact clears every floor ──────────────────────────


def test_known_good_artifact_no_block_no_false_warnings(spec):
    spec["embedding_check"]["enabled"] = False
    # A single-item known-good artifact carries enough prose to clear the
    # per-field floors but not the corpus-wide min_total_prose_words (300),
    # which assumes a multi-item briefing. Relax just that floor so the test
    # exercises a clean single-item artifact without padding filler prose.
    spec["completeness"]["min_total_prose_words"] = 30
    overview = (
        "The council will vote on the proposed downtown parking ordinance, which "
        "adjusts meter rates and adds two hours of free evening parking downtown. "
        "Staff recommends approval; the measure follows months of public comment and "
        "an evaluation of nearby retail foot traffic during evening hours."
    )
    summary = (
        "The council will vote on the proposed downtown parking ordinance that "
        "adjusts meter rates and adds free evening parking hours downtown."
    )
    # Two claims per featured item so claim_coverage passes; extracts overlap the
    # source snapshot (so extracts_appear_in_cited_source passes) and overlap the
    # summary lexically (so coherence passes).
    snapshot = (
        "Ordinance 2026-14: the downtown parking ordinance adjusts meter rates and "
        "adds two hours of free evening parking downtown. Council vote scheduled."
    )
    artifact = _base_artifact(
        featured_titles=["Downtown parking ordinance"],
        featured_overviews=[overview],
        featured_summaries=[summary],
        lead_in="One item on tonight's agenda requires your attention and a vote.",
    )
    artifact["sources"] = [
        {"id": "src_1", "source_type": "agenda_packet", "retrieved_text_or_snapshot": snapshot}
    ]
    artifact["claims"] = [
        {
            "claim_id": "claim_001",
            "item_id": "item_001",
            "claim_type": "vote_or_decision_fact",
            "claim_weight": "high",
            "claim_text": "The council will vote on the downtown parking ordinance.",
            "source_ids": ["src_1"],
            "source_extracts": [
                {"text": "the downtown parking ordinance adjusts meter rates", "extract_type": "quote"}
            ],
        },
        {
            "claim_id": "claim_002",
            "item_id": "item_001",
            "claim_type": "background_context",
            "claim_weight": "medium",
            "claim_text": "The ordinance adds two hours of free evening parking.",
            "source_ids": ["src_1"],
            "source_extracts": [
                {"text": "adds two hours of free evening parking downtown", "extract_type": "quote"}
            ],
        },
    ]

    results = qa_validate.run_deterministic(artifact, spec)
    # This artifact is hand-built to exercise the content-quality checks
    # (completeness, polish, prohibited phrases, provenance), using minimal
    # claims/sources whose claim_type vocabulary is not the manifest's enum, so
    # it is not a Layer-1-schema-complete briefing. Layer-1 schema_validation is
    # a separate, staged (warning-only) concern with its own coverage in
    # test_qa_validate_ws2.py, so exclude it here.
    content = [r for r in results if r.check_id != "schema_validation"]
    # No blocking failure.
    assert not [r for r in content if r.route == "block" and r.status == "fail"]
    # No annotate-routed warning (completeness, polish, prohibited phrases, provenance).
    assert not [
        r for r in content
        if r.route == "annotate" and r.status in ("warning", "fail")
    ]
    assert qa_validate.compute_release_verdict(content, []) == "ok"
    status, _ = qa_validate.route(content, [], qa_validate.blockable_types(spec))
    assert status == "OK"


# ── known-bad: unsupported extract blocks ────────────────────────────────────


def test_known_bad_unsupported_extract_blocks(spec):
    spec["embedding_check"]["enabled"] = False
    artifact = json.loads((FIXTURES / "known_bad_unsupported_extract.json").read_text())
    results = qa_validate.run_deterministic(artifact, spec)
    status, reason = qa_validate.route(results, [], qa_validate.blockable_types(spec))
    assert status == "Block"
    assert "extracts_appear_in_cited_source" in reason
    blocker = _find(results, "extracts_appear_in_cited_source")
    assert blocker is not None
    assert blocker.route == "block"
    assert blocker.status == "fail"
    assert qa_validate.compute_release_verdict(results, []) == "block"
