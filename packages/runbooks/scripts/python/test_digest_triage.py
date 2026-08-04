"""digest_triage: deterministic tiering + item assembly (DATA-2174)."""

from __future__ import annotations

from datetime import date

import digest_triage as dt


def _rec(event, *, status="active", rank=99, okr=None, on_watchlist=False,
         elevated=False, anomaly=None, cnt=100, pr=None):
    return {
        "event_type": event, "status": status, "rank": rank, "okr": okr,
        "on_watchlist": on_watchlist, "elevated": elevated, "anomaly": anomaly,
        "event_count_30d": cnt, "last_seen_date": date(2026, 7, 28),
        "instrumented_pr": pr, "divergence": None, "gpmeta": None,
    }


def _result(flagged):
    return {"run_date": date(2026, 8, 4), "flagged": flagged, "proposals": []}


NO_CHANGES = {"new": [], "escalated": [], "resolved": [], "still_open": []}


# --- rules_tier ---------------------------------------------------------------

def test_okr_break_is_red():
    item = {"okr": "Active Candidates", "rank": 6, "on_watchlist": True, "change": "new"}
    assert dt.rules_tier(item) == "red"


def test_okr_divergence_rank5_is_not_red():
    item = {"okr": "Active Candidates", "rank": 5, "on_watchlist": True, "change": "new"}
    assert dt.rules_tier(item) == "yellow"


def test_watchlist_rank2_is_red_without_okr():
    item = {"okr": None, "rank": 2, "on_watchlist": True, "change": "escalated"}
    assert dt.rules_tier(item) == "red"


def test_non_watchlist_rank1_is_yellow():
    item = {"okr": None, "rank": 1, "on_watchlist": False, "change": "new"}
    assert dt.rules_tier(item) == "yellow"


def test_resolved_is_fyi_even_on_watchlist():
    item = {"okr": None, "rank": 99, "on_watchlist": True, "change": "resolved"}
    assert dt.rules_tier(item) == "fyi"


def test_plain_transition_is_fyi():
    item = {"okr": None, "rank": 8, "on_watchlist": False, "elevated": False, "change": "new"}
    assert dt.rules_tier(item) == "fyi"


def test_anomaly_without_watchlist_is_yellow():
    item = {"okr": None, "rank": 4, "on_watchlist": False, "elevated": False,
            "change": None, "anomaly": {"current": 0, "baseline": 292.0}}
    assert dt.rules_tier(item) == "yellow"


# --- build_items --------------------------------------------------------------

def test_build_items_covers_changes_and_new_anomalies():
    flagged = [
        _rec("A", status="dormant", rank=8),
        _rec("B", rank=4, anomaly={"current": 10, "baseline": 200.0}),
    ]
    changes = {"new": ["A"], "escalated": [], "resolved": ["Gone"], "still_open": ["B"]}
    items = dt.build_items(_result(flagged), changes,
                           prior_state={"B": "active", "Gone": "dormant"},
                           prior_anomalous=set())
    by_id = {i["id"]: i for i in items}
    assert by_id["A"]["change"] == "new"
    assert by_id["Gone"]["change"] == "resolved" and by_id["Gone"]["status"] is None
    # B: unchanged status but newly anomalous -> included
    assert by_id["B"]["anomaly"]["baseline"] == 200.0


def test_build_items_persists_okr_break_without_any_change():
    flagged = [_rec("D", status="dormant", rank=6, okr="Active Candidates",
                    on_watchlist=True, elevated=True, cnt=0)]
    items = dt.build_items(_result(flagged), NO_CHANGES,
                           prior_state={"D": "dormant"}, prior_anomalous=set())
    assert [i["id"] for i in items] == ["D"]
    assert items[0]["change"] == "still_open"
    assert dt.rules_tier(items[0]) == "red"


def test_build_items_does_not_persist_non_okr_still_open():
    flagged = [_rec("E", status="dormant", rank=8)]
    items = dt.build_items(_result(flagged), NO_CHANGES,
                           prior_state={"E": "dormant"}, prior_anomalous=set())
    assert items == []


def test_build_items_suppresses_anomaly_when_prior_unknown():
    flagged = [_rec("B", rank=4, anomaly={"current": 10, "baseline": 200.0})]
    items = dt.build_items(_result(flagged), NO_CHANGES,
                           prior_state=None, prior_anomalous=None)
    assert items == []


# --- fallback text ------------------------------------------------------------

def test_fallback_headline_anomaly_and_transition():
    assert dt._fallback_headline(
        {"anomaly": {"current": 0, "baseline": 292.0}}) == "-100% WoW (292 → 0)"
    assert dt._fallback_headline(
        {"anomaly": None, "change": "escalated", "prior_status": "dormant",
         "status": "orphaned_firing"}) == "dormant → orphaned_firing"
    assert dt._fallback_headline(
        {"anomaly": None, "change": "new", "status": "dormant"}) == "newly flagged (dormant)"
    assert dt._fallback_headline({"anomaly": None, "change": "resolved"}) == "resolved"
    assert dt._fallback_headline(
        {"anomaly": None, "change": "still_open", "status": "dormant"}) == "still dormant"


def test_sanitize_strips_newlines_and_caps():
    assert dt._sanitize("a\nb\r\nc") == "a b c"
    assert len(dt._sanitize("x" * 500)) == 200
    assert dt._sanitize(None) == ""
