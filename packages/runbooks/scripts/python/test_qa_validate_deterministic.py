"""Tests for qa_validate.py deterministic checks against the flattened
executive_summary shape (manifest v5+).

Locks the behavior after executive_summary collapsed from a structured
object with items[] to a single-field {lead_in} object. The per-featured-
item overview now lives on each items[].display.executive_summary_overview;
the renderer composes the top-of-briefing section at render time by walking
items[].filter(tier=='featured') in agenda order.

Coverage:
- _values_at_path resolves dotted prefixes for arrays and per-item display
  fields.
- completeness_floor measures exec_summary as lead_in + sum of featured
  items' executive_summary_overview.
- _iter_polish_prose yields lead_in plus each featured item's
  executive_summary_overview as a separate path.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import qa_validate

SPEC_PATH = Path(__file__).resolve().parent / "meeting_briefing_product_spec.json"


@pytest.fixture
def spec() -> dict:
    return json.loads(SPEC_PATH.read_text())


def _featured_item(idx: int, title: str, *, overview: str = "Some featured overview.") -> dict:
    return {
        "id": f"item_{idx:03d}",
        "item_number": str(idx),
        "title": title,
        "tier": "featured",
        "vote_required": True,
        "tier_reason": ["vote_required"],
        "display": {
            "summary": "Some featured summary.",
            "executive_summary_overview": overview,
        },
        "research": {"raw_context": [], "full_treatment": None},
    }


def _base_artifact(*, featured_titles=None, featured_overviews=None, lead_in="The following items require action:") -> dict:
    featured_titles = featured_titles or []
    featured_overviews = featured_overviews or ["Some featured overview." for _ in featured_titles]
    items = [
        _featured_item(i, t, overview=o)
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
        "estimated_read_minutes": 5,
        "executive_summary": {"lead_in": lead_in},
        "run_metadata": {
            "agenda_packet_url": None,
            "source_bundle_retrieved_at": "2026-05-26T00:00:00Z",
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


def test_values_at_path_resolves_per_item_display_field():
    artifact = {
        "items": [
            {"id": "item_001", "display": {"executive_summary_overview": "First."}},
            {"id": "item_002", "display": {"executive_summary_overview": "Second."}},
        ]
    }
    assert qa_validate._values_at_path(
        artifact, "items[].display.executive_summary_overview"
    ) == ["First.", "Second."]


def test_values_at_path_resolves_lead_in():
    artifact = {"executive_summary": {"lead_in": "Lead text."}}
    assert qa_validate._values_at_path(artifact, "executive_summary.lead_in") == ["Lead text."]


def test_values_at_path_returns_empty_for_wrong_shape():
    legacy = {"executive_summary": "legacy string form"}
    assert qa_validate._values_at_path(legacy, "executive_summary.lead_in") == []


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


def test_completeness_floor_skips_non_featured_overviews(spec):
    """Queued / standard items have null executive_summary_overview by schema;
    they must not contribute to the lead+overview total."""
    spec["completeness"]["min_executive_summary_chars"] = 1
    artifact = _base_artifact(featured_titles=["A"], featured_overviews=["F" * 80])
    # Add a queued item with a (schema-invalid) populated overview; check it's ignored
    artifact["items"].append({
        "id": "item_999",
        "item_number": "99",
        "title": "Queued thing",
        "tier": "queued",
        "vote_required": False,
        "tier_reason": ["staff_recommendation"],
        "display": {
            "summary": "Queued summary.",
            "executive_summary_overview": "Q" * 200,
        },
        "research": {"raw_context": [], "full_treatment": None},
    })
    results = qa_validate.run_deterministic(artifact, spec)
    comp = _find(results, "completeness_floor")
    assert comp.details["executive_summary"]["overview_chars"] == 80  # not 280


# ── _iter_polish_prose ───────────────────────────────────────────────────────


def test_iter_polish_prose_yields_lead_in_and_per_item_overviews():
    artifact = _base_artifact(
        featured_titles=["Foo"],
        featured_overviews=["A featured overview sentence."],
        lead_in="Lead sentence.",
    )
    paths = dict(qa_validate._iter_polish_prose(artifact))
    assert paths.get("$.executive_summary.lead_in") == "Lead sentence."
    assert paths.get("$.items[item_001].display.executive_summary_overview") == "A featured overview sentence."


def test_iter_polish_prose_skips_null_overview():
    """Non-featured items have null executive_summary_overview — must not yield."""
    artifact = _base_artifact(featured_titles=["A"])
    artifact["items"][0]["display"]["executive_summary_overview"] = None
    paths = dict(qa_validate._iter_polish_prose(artifact))
    assert "$.items[item_001].display.executive_summary_overview" not in paths


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


def test_urls_resolve_self_skips_when_spec_disabled_even_with_flag(spec):
    spec["citation_paths"] = ["items[].display.summary"]
    spec["url_check"] = {"enabled": False}
    artifact = _base_artifact(featured_titles=["Foo"])
    artifact["items"][0]["display"]["summary"] = "[Example](https://example.com/) page."
    results = qa_validate.run_deterministic(artifact, spec, check_urls=True)
    assert _find(results, "urls_resolve") is None
