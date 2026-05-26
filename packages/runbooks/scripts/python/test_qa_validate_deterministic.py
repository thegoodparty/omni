"""Tests for qa_validate.py deterministic checks against the structured
executive_summary shape (manifest v4+).

Locks the behavior added when executive_summary went from a string to a
{lead_in, items[]: {item_id, title, overview}} object:

- _values_at_path supports dotted prefixes for arrays (exec.items[].x).
- completeness_floor measures exec_summary as lead_in + sum(overviews).
- _iter_polish_prose yields exec_summary string fields separately.
- executive_summary_items_resolve covers pass / unknown id /
  not-featured / title mismatch / ordering mismatch / empty cases.
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


def _featured_item(idx: int, title: str) -> dict:
    return {
        "id": f"item_{idx:03d}",
        "item_number": str(idx),
        "title": title,
        "tier": "featured",
        "vote_required": True,
        "tier_reason": ["vote_required"],
        "display": {"summary": "Some featured summary."},
        "research": {"raw_context": [], "full_treatment": None},
    }


def _base_artifact(*, exec_items=None, featured_titles=None) -> dict:
    featured_titles = featured_titles or []
    items = [_featured_item(i, t) for i, t in enumerate(featured_titles, start=1)]
    exec_summary = {
        "lead_in": "The following items require action:",
        "items": exec_items if exec_items is not None else [],
    }
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
        "executive_summary": exec_summary,
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


def test_values_at_path_nested_array_resolves():
    artifact = {
        "executive_summary": {
            "lead_in": "Lead text.",
            "items": [
                {"overview": "First overview."},
                {"overview": "Second overview."},
            ],
        }
    }
    assert qa_validate._values_at_path(artifact, "executive_summary.lead_in") == ["Lead text."]
    assert qa_validate._values_at_path(
        artifact, "executive_summary.items[].overview"
    ) == ["First overview.", "Second overview."]


def test_values_at_path_returns_empty_for_wrong_shape():
    legacy = {"executive_summary": "legacy string form"}
    assert qa_validate._values_at_path(legacy, "executive_summary.lead_in") == []
    assert qa_validate._values_at_path(legacy, "executive_summary.items[].overview") == []


# ── completeness_floor exec_summary measurement ──────────────────────────────


def test_completeness_floor_sums_lead_in_and_overviews(spec):
    spec["completeness"]["min_executive_summary_chars"] = 50
    artifact = _base_artifact(
        featured_titles=["A"],
        exec_items=[{"item_id": "item_001", "title": "A", "overview": "X" * 100}],
    )
    artifact["executive_summary"]["lead_in"] = "Y" * 30
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
        exec_items=[{"item_id": "item_001", "title": "Short", "overview": "tiny"}],
    )
    artifact["executive_summary"]["lead_in"] = "Brief lead."
    results = qa_validate.run_deterministic(artifact, spec)
    comp = _find(results, "completeness_floor")
    assert comp is not None
    assert comp.status == "warning"
    assert "executive_summary" in comp.message


# ── _iter_polish_prose ───────────────────────────────────────────────────────


def test_iter_polish_prose_yields_exec_summary_strings():
    artifact = _base_artifact(
        featured_titles=["Foo"],
        exec_items=[
            {"item_id": "item_001", "title": "Foo", "overview": "An overview sentence."}
        ],
    )
    artifact["executive_summary"]["lead_in"] = "Lead sentence."
    paths = dict(qa_validate._iter_polish_prose(artifact))
    assert paths.get("$.executive_summary.lead_in") == "Lead sentence."
    assert paths.get("$.executive_summary.items[0].overview") == "An overview sentence."


# ── executive_summary_items_resolve ──────────────────────────────────────────


def test_exec_summary_items_resolve_pass(spec):
    artifact = _base_artifact(
        featured_titles=["A", "B"],
        exec_items=[
            {"item_id": "item_001", "title": "A", "overview": "Overview A."},
            {"item_id": "item_002", "title": "B", "overview": "Overview B."},
        ],
    )
    chk = _find(qa_validate.run_deterministic(artifact, spec), "executive_summary_items_resolve")
    assert chk is not None
    assert chk.status == "pass"
    assert chk.route == "pass"


def test_exec_summary_items_resolve_unknown_id_blocks(spec):
    artifact = _base_artifact(
        featured_titles=["A"],
        exec_items=[{"item_id": "item_999", "title": "A", "overview": "Overview."}],
    )
    chk = _find(qa_validate.run_deterministic(artifact, spec), "executive_summary_items_resolve")
    assert chk is not None
    assert chk.status == "fail"
    assert chk.route == "block"
    assert "unresolved" in chk.message


def test_exec_summary_items_resolve_not_featured_blocks(spec):
    artifact = _base_artifact(
        featured_titles=["A"],
        exec_items=[{"item_id": "item_001", "title": "A", "overview": "Overview."}],
    )
    artifact["items"][0]["tier"] = "standard"  # demote
    chk = _find(qa_validate.run_deterministic(artifact, spec), "executive_summary_items_resolve")
    assert chk is not None
    assert chk.status == "fail"
    assert chk.route == "block"
    assert "not tier=featured" in chk.message


def test_exec_summary_items_resolve_title_mismatch_annotates(spec):
    artifact = _base_artifact(
        featured_titles=["Original Title"],
        exec_items=[
            {"item_id": "item_001", "title": "Different Title", "overview": "Overview."}
        ],
    )
    chk = _find(qa_validate.run_deterministic(artifact, spec), "executive_summary_items_resolve")
    assert chk is not None
    assert chk.status == "warning"
    assert chk.route == "annotate"
    assert "title mismatch" in chk.message


def test_exec_summary_items_resolve_ordering_mismatch_annotates(spec):
    artifact = _base_artifact(
        featured_titles=["A", "B"],
        exec_items=[
            {"item_id": "item_002", "title": "B", "overview": "Overview B."},
            {"item_id": "item_001", "title": "A", "overview": "Overview A."},
        ],
    )
    chk = _find(qa_validate.run_deterministic(artifact, spec), "executive_summary_items_resolve")
    assert chk is not None
    assert chk.status == "warning"
    assert chk.route == "annotate"
    assert "order" in chk.message


def test_exec_summary_items_resolve_empty_no_featured_passes(spec):
    """Placeholder-like case: no featured items, exec_summary.items: []."""
    artifact = _base_artifact(featured_titles=[], exec_items=[])
    chk = _find(qa_validate.run_deterministic(artifact, spec), "executive_summary_items_resolve")
    assert chk is not None
    assert chk.status == "pass"


def test_exec_summary_items_resolve_empty_with_featured_annotates(spec):
    """Featured items exist but exec_summary.items is empty — ordering mismatch."""
    artifact = _base_artifact(featured_titles=["A"], exec_items=[])
    chk = _find(qa_validate.run_deterministic(artifact, spec), "executive_summary_items_resolve")
    assert chk is not None
    assert chk.status == "warning"
    assert chk.route == "annotate"
