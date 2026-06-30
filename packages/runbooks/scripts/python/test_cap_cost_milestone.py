"""Behavioral contract for the milestone cost-attribution path.

These lock the PURE functions that consume agent-emitted milestone markers:
parse_milestones (extract) and milestone_at (extract), plus milestone_costs and
detect_hot_milestones (analyze/hotspots). The mixed-tzinfo cases here are the ones
that motivated the tz-normalization fix — a 'Z' turn vs a '+00:00' marker, and a
NAIVE turn vs an aware marker, must compare without raising. No S3/DB.
"""
import pandas as pd

from cap_cost_extract import parse_milestones, milestone_at
from cap_cost_analyze import milestone_costs
from cap_cost_hotspots import detect_hot_milestones


def test_parse_milestones_sorts_and_drops_malformed():
    text = "\n".join(
        [
            '{"ts": "2026-01-01T00:00:02+00:00", "name": "second"}',
            '{"ts": "2026-01-01T00:00:01+00:00", "name": "first"}',
            "not json at all",
            '{"ts": "2026-01-01T00:00:03+00:00"}',  # no name -> dropped
            '{"name": "no_ts"}',  # no ts -> dropped
            "",
        ]
    )
    markers = parse_milestones(text)
    assert [m["name"] for m in markers] == ["first", "second"]


def test_milestone_at_boundary_z_vs_offset():
    # Marker written with +00:00, turn written with Z, equal instant -> at/before
    # is inclusive, so the marker is active on its own boundary.
    markers = [{"ts": "2026-01-01T00:00:00+00:00", "name": "alpha"}]
    assert milestone_at(markers, "2026-01-01T00:00:00Z") == "alpha"


def test_milestone_at_naive_turn_vs_aware_marker_does_not_raise():
    # The bug: a naive turn_ts (no offset) compared to an aware marker raised
    # TypeError. Naive is treated as UTC, so this resolves rather than crashes.
    markers = [{"ts": "2026-01-01T00:00:00+00:00", "name": "alpha"}]
    assert milestone_at(markers, "2026-01-01T00:00:05") == "alpha"


def test_milestone_at_naive_marker_vs_aware_turn_does_not_raise():
    markers = [{"ts": "2026-01-01T00:00:00", "name": "alpha"}]
    assert milestone_at(markers, "2026-01-01T00:00:05Z") == "alpha"


def test_milestone_at_no_marker_before_turn_is_none():
    markers = [{"ts": "2026-01-01T00:00:10+00:00", "name": "alpha"}]
    assert milestone_at(markers, "2026-01-01T00:00:05Z") is None


def test_milestone_at_picks_most_recent_preceding():
    markers = [
        {"ts": "2026-01-01T00:00:01+00:00", "name": "first"},
        {"ts": "2026-01-01T00:00:05+00:00", "name": "second"},
    ]
    assert milestone_at(markers, "2026-01-01T00:00:03Z") == "first"
    assert milestone_at(markers, "2026-01-01T00:00:09Z") == "second"


def _milestone_df():
    return pd.DataFrame(
        [
            {"run_id": "r1", "milestone": "setup", "est_cost": 1.0, "turn_idx": 0,
             "tool_calls": "Read", "cache_read": 10, "tokens": 100, "run_cost_usd": 9.0,
             "status": "completed"},
            {"run_id": "r1", "milestone": "work", "est_cost": 8.0, "turn_idx": 1,
             "tool_calls": "Bash", "cache_read": 20, "tokens": 200, "run_cost_usd": 9.0,
             "status": "completed"},
            {"run_id": "r2", "milestone": "setup", "est_cost": 1.0, "turn_idx": 0,
             "tool_calls": "Read", "cache_read": 10, "tokens": 100, "run_cost_usd": 1.0,
             "status": "completed"},
        ]
    )


def test_milestone_costs_share_of_total():
    out = milestone_costs(_milestone_df())
    by_name = {r["milestone"]: r for r in out["ordered"]}
    # total = 1 + 8 + 1 = 10; "work" = 8 -> 0.8 share.
    assert by_name["work"]["total"] == 8.0
    assert by_name["work"]["share_of_spend"] == 0.8
    assert by_name["setup"]["total"] == 2.0
    assert by_name["setup"]["share_of_spend"] == 0.2
    assert out["runs_with_milestones"] == 2
    # run-sequence order: setup (turn 0) before work (turn 1).
    assert [r["milestone"] for r in out["ordered"]] == ["setup", "work"]


def test_detect_hot_milestones_flags_outsized_share():
    hot = detect_hot_milestones(_milestone_df(), margin=1.5)
    names = [r["milestone"] for r in hot]
    # uniform share across 2 milestones = 0.5; "work" at 0.8 >= 0.5*1.5=0.75 -> hot.
    # "setup" at 0.2 is not.
    assert names == ["work"]
