"""Unit tests for the analytics event health monitor pure logic (DATA-1952).

Pure functions only — no Databricks, no filesystem. Run from scripts/python with
``uv run pytest test_analytics_event_health.py``.
"""

from __future__ import annotations

from datetime import date, datetime

import analytics_event_health as eh

TODAY = date(2026, 6, 25)  # a Thursday; current (in-progress) week starts Mon 2026-06-22
MONDAY = date(2026, 6, 22)


# --- to_date -----------------------------------------------------------------


def test_to_date_handles_datetime_before_date():
    # datetime subclasses date; must coerce to a plain date, not pass through.
    assert eh.to_date(datetime(2026, 6, 25, 13, 30)) == date(2026, 6, 25)


def test_to_date_handles_date_string_and_empty():
    assert eh.to_date(date(2026, 1, 1)) == date(2026, 1, 1)
    assert eh.to_date("2026-01-02T00:00:00") == date(2026, 1, 2)
    assert eh.to_date("") is None
    assert eh.to_date(None) is None


# --- parse_gpmeta ------------------------------------------------------------


def test_parse_gpmeta_absent_returns_none():
    assert eh.parse_gpmeta(None) is None
    assert eh.parse_gpmeta("a plain description, no markers") is None


def test_parse_gpmeta_extracts_intent_and_supersession():
    desc = (
        "<!-- gp-meta -->\n"
        "Fires when a member submits an issue.\n"
        "supersession: superseded by serve-community-issues-v1 (adds category)\n"
        "not in use: 2026-06-18 (replaced, #1234)\n"
        "<!-- /gp-meta -->\n"
    )
    meta = eh.parse_gpmeta(desc)
    assert meta["intent"] == "not_in_use"
    assert meta["supersession"].startswith("superseded by serve-community-issues-v1")


def test_parse_gpmeta_in_use():
    desc = "<!-- gp-meta -->\npurpose line\nin use: 2026-06-18 (#1)\n<!-- /gp-meta -->"
    assert eh.parse_gpmeta(desc)["intent"] == "in_use"


# --- is_system / is_elevated -------------------------------------------------


def test_is_system_by_family_and_name():
    assert eh.is_system("amplitude_autotrack", "anything")
    assert eh.is_system("session_or_browser", "x")
    assert eh.is_system("other", "gtm.js")
    assert eh.is_system("other", "Page Viewed")
    assert eh.is_system("other", "Viewed /elections/pa")
    assert eh.is_system("other", "[Amplitude] Network Request")
    assert not eh.is_system("win_onboarding", "Onboarding - User Created")


def test_has_description():
    assert eh.has_description("Fires when a user submits the office step.")
    assert not eh.has_description(None)
    assert not eh.has_description("")
    assert not eh.has_description("   \n\t ")


def test_is_elevated_family_prefix_and_text():
    assert eh.is_elevated("win_onboarding", "x", None)
    assert eh.is_elevated("win_compliance_or_registration", "x", None)
    assert eh.is_elevated("serve", "Serve Onboarding - Welcome Viewed", None)
    assert eh.is_elevated("other", "x", "fires on registration submit")
    assert not eh.is_elevated("win_dashboard", "Dashboard - Tab Switched", "a normal view")


def test_is_elevated_on_watchlist():
    # A curated-watchlist event elevates even if its family/text would not.
    assert eh.is_elevated("win_dashboard", "Dashboard - Tab Switched", "a normal view", on_watchlist=True)


# --- detect_anomaly ----------------------------------------------------------


def _weeks(counts):
    # ascending (week_start, count); detect_anomaly reads by position, not by the date.
    return [(date(2026, 5, 4), c) for c in counts]


def test_detect_anomaly_needs_enough_weeks():
    assert eh.detect_anomaly(_weeks([100, 100, 100])) is None  # < 5 weeks


def test_detect_anomaly_flags_drop_below_pct():
    anom = eh.detect_anomaly(_weeks([100, 100, 100, 100, 2]))
    assert anom == {"current": 2, "baseline": 100.0}


def test_detect_anomaly_no_flag_when_stable():
    assert eh.detect_anomaly(_weeks([100, 100, 100, 100, 60])) is None


def test_detect_anomaly_low_baseline_uses_drop_to_zero():
    assert eh.detect_anomaly(_weeks([2, 2, 2, 2, 0])) == {"current": 0, "baseline": 2.0}
    assert eh.detect_anomaly(_weeks([2, 2, 2, 2, 1])) is None  # nonzero, low baseline -> no flag


def test_detect_anomaly_zero_baseline_returns_none():
    assert eh.detect_anomaly(_weeks([0, 0, 0, 0, 0])) is None


# --- classify_status ---------------------------------------------------------


def test_classify_status_branches():
    assert (
        eh.classify_status(in_code=None, firing_recent=True, retired_date=None, today=TODAY) == "code_unknown"
    )
    assert eh.classify_status(in_code=True, firing_recent=True, retired_date=None, today=TODAY) == "active"
    assert eh.classify_status(in_code=True, firing_recent=False, retired_date=None, today=TODAY) == "dormant"
    assert (
        eh.classify_status(in_code=True, firing_recent=True, retired_date=date(2026, 6, 1), today=TODAY)
        == "orphaned_firing"
    )
    assert (
        eh.classify_status(in_code=True, firing_recent=False, retired_date=date(2026, 6, 20), today=TODAY)
        == "deprecating"  # within 30d holding window
    )
    assert (
        eh.classify_status(in_code=True, firing_recent=False, retired_date=date(2026, 1, 1), today=TODAY)
        == "retired"  # past the window
    )


# --- divergence / rank -------------------------------------------------------


def test_divergence_flags():
    assert eh.divergence({"intent": "not_in_use", "supersession": None}, "active", True).endswith(
        "still firing"
    )
    assert "code removed" in eh.divergence({"intent": "in_use", "supersession": None}, "retired", False)
    assert eh.divergence(None, "active", True) is None


def test_rank_record_priority():
    def rec(**kw):
        base = {
            "status": "active", "elevated": False, "anomaly": None,
            "divergence": None, "call_site_count": None, "event_count_30d": 0,
        }
        base.update(kw)
        return base

    assert eh.rank_record(rec(status="orphaned_firing")) == 1
    # NEW: declared in code, zero call sites, not firing -> high-severity flag
    assert eh.rank_record(rec(status="dormant", call_site_count=0)) == 2
    # NEW: zero call sites + anomaly drop on still-active code also ranks here
    assert eh.rank_record(rec(status="active", call_site_count=0, anomaly={"current": 1, "baseline": 9})) == 2
    assert eh.rank_record(rec(status="active", elevated=True, anomaly={"current": 1, "baseline": 9})) == 3
    assert eh.rank_record(rec(status="active", anomaly={"current": 1, "baseline": 9})) == 4
    assert eh.rank_record(rec(status="system", anomaly={"current": 1, "baseline": 9})) == 4
    assert eh.rank_record(rec(status="code_unknown", anomaly={"current": 1, "baseline": 9})) == 4
    assert eh.rank_record(rec(status="code_unknown")) == 99
    assert eh.rank_record(rec(status="dormant", elevated=True)) == 6
    assert eh.rank_record(rec(status="instrumented_never_observed")) == 7
    assert eh.rank_record(rec(status="dormant")) == 8
    assert eh.rank_record(rec(status="active")) == 99


def test_rank_record_null_call_sites_does_not_flag():
    # Backend / dynamic events have no resolvable key-path -> call_site_count None -> never
    # the new flag (null != zero). A plain dormant stays dormant (rank 8).
    rec = {"status": "dormant", "elevated": False, "anomaly": None,
           "divergence": None, "call_site_count": None, "event_count_30d": 0}
    assert eh.rank_record(rec) == 8


def test_rank_record_zero_calls_still_firing_no_anomaly_not_flagged():
    # Zero callers but data still arriving and no drop yet is out of scope for this flag.
    rec = {"status": "active", "elevated": False, "anomaly": None,
           "divergence": None, "call_site_count": 0, "event_count_30d": 50}
    assert eh.rank_record(rec) == 99


# --- weekly_series -----------------------------------------------------------


def test_weekly_series_excludes_in_progress_week_and_sorts():
    rows = [
        {"event_type": "A", "week_start": datetime(2026, 6, 8), "n": 10},
        {"event_type": "A", "week_start": datetime(2026, 6, 1), "n": 5},
        {"event_type": "A", "week_start": datetime(2026, 6, 22), "n": 99},  # in-progress, dropped
    ]
    series = eh.weekly_series(rows, MONDAY)
    assert series["A"] == [(date(2026, 6, 1), 5), (date(2026, 6, 8), 10)]


# --- propose_watchlist_additions ---------------------------------------------


def _prop(event_type, family, first_seen, cnt30=10):
    return {
        "event_type": event_type,
        "family": family,
        "first_seen_date": first_seen,
        "event_count_30d": cnt30,
    }


def test_propose_watchlist_additions():
    catalog = [
        # in a watched family, recent, firing, not on the list -> proposed
        _prop("Onboarding - New Step", "win_onboarding", date(2026, 6, 1)),
        # already on the curated list -> skipped
        _prop("Onboarding - User Created", "win_onboarding", date(2026, 6, 2)),
        # watched family but first seen too long ago -> skipped
        _prop("Onboarding - Old Step", "win_onboarding", date(2025, 1, 1)),
        # not a watched family -> skipped
        _prop("Misc Thing", "other", date(2026, 6, 3)),
        # system event in a watched family -> skipped
        _prop("page", "win_onboarding", date(2026, 6, 4)),
        # recent + in family but NOT firing (dormant / retired-and-quiet) -> skipped
        _prop("Onboarding - Dead Step", "win_onboarding", date(2026, 6, 5), cnt30=0),
        # recent + firing but RETIRED in code (orphaned-firing old half of a rename) -> skipped
        _prop("Onboarding - Renamed Away", "win_onboarding", date(2026, 6, 6)),
    ]
    code = {"Onboarding - Renamed Away": {"retired_date": "2026-06-10", "instrumented_pr": "#1"}}
    proposals = eh.propose_watchlist_additions(
        catalog,
        code,
        watched_families={"win_onboarding"},
        watchlist_events={"Onboarding - User Created"},
        today=TODAY,
    )
    # only the live, recent, in-family, not-already-watched event survives
    assert [p["event_type"] for p in proposals] == ["Onboarding - New Step"]
    assert proposals[0]["family"] == "win_onboarding"


# --- reconcile (end-to-end over fixtures) ------------------------------------


def test_reconcile_classifies_counts_and_ranks():
    catalog = [
        {
            "event_type": "Active One",
            "family": "win_dashboard",
            "is_win": True,
            "first_seen_date": None,
            "last_seen_date": date(2026, 6, 24),
            "event_count": 999,
            "event_count_30d": 100,
            "govern_description": None,
            "in_govern_taxonomy": True,
        },
        {
            "event_type": "Onboarding - User Created",
            "family": "win_onboarding",
            "is_win": True,
            "first_seen_date": None,
            "last_seen_date": date(2026, 1, 1),
            "event_count": 5,
            "event_count_30d": 0,
            "govern_description": None,
            "in_govern_taxonomy": True,
        },
        {
            "event_type": "Orphan Event",
            "family": "win_voter_data",
            "is_win": True,
            "first_seen_date": None,
            "last_seen_date": date(2026, 6, 20),
            "event_count": 50,
            "event_count_30d": 5,
            "govern_description": None,
            "in_govern_taxonomy": True,
        },
        {
            "event_type": "page",
            "family": "amplitude_autotrack",
            "is_win": False,
            "first_seen_date": None,
            "last_seen_date": date(2026, 1, 1),
            "event_count": 1,
            "event_count_30d": 0,
            "govern_description": None,
            "in_govern_taxonomy": False,
        },
        {
            "event_type": "Brand New",
            "family": "other",
            "is_win": False,
            "first_seen_date": None,
            "last_seen_date": date(2026, 6, 24),
            "event_count": 10,
            "event_count_30d": 10,
            "govern_description": None,
            "in_govern_taxonomy": True,
        },
    ]
    code = {
        "Active One": {"retired_date": "", "instrumented_pr": "#1"},
        "Onboarding - User Created": {"retired_date": "", "instrumented_pr": "#2"},
        "Orphan Event": {"retired_date": "2026-06-01", "instrumented_pr": "#3"},
        "page": {"retired_date": "", "instrumented_pr": ""},
        "Never Fired": {"retired_date": "", "instrumented_pr": "#9"},  # not in catalog
    }
    result = eh.reconcile(catalog, [], code, TODAY)

    counts = result["status_counts"]
    assert counts["active"] == 1
    assert counts["dormant"] == 1
    assert counts["orphaned_firing"] == 1
    assert counts["system"] == 1
    assert counts["code_unknown"] == 1
    assert counts["instrumented_never_observed"] == 1

    flagged_types = [r["event_type"] for r in result["flagged"]]
    # ranked: orphan (1) -> onboarding dormant elevated (6) -> never-fired (7)
    assert flagged_types == ["Orphan Event", "Onboarding - User Created", "Never Fired"]
    # system + active + brand-new are not flagged
    assert "page" not in flagged_types
    assert "Active One" not in flagged_types
    assert "Brand New" not in flagged_types


def test_reconcile_flags_removed_call_site_with_surviving_constant():
    # Reconstructs the 2026-06-13 state: the name literal is still declared (code row present,
    # retired_date empty -> in_code), but the only call site was deleted (call_site_count 0)
    # and firing has flatlined (event_count_30d 0). This is the DATA-2046 acceptance case:
    # Stage 1 must flag it with no manual git work.
    catalog = [
        {
            "event_type": "Dashboard - Candidate Dashboard Viewed",
            "family": "win_dashboard", "is_win": True,
            "first_seen_date": None, "last_seen_date": date(2026, 6, 13),
            "event_count": 500, "event_count_30d": 0,
            "govern_description": None, "in_govern_taxonomy": True,
        },
    ]
    code = {
        "Dashboard - Candidate Dashboard Viewed": {
            "retired_date": "", "instrumented_pr": "#10",
            "call_site_count": "0", "call_site_retired_date": "2026-06-13",
        },
    }
    result = eh.reconcile(catalog, [], code, TODAY)
    rec = result["records"][0]
    assert rec["status"] == "dormant"          # literal present, not firing
    assert rec["call_site_count"] == 0
    assert rec["rank"] == 2
    assert [r["event_type"] for r in result["flagged"]] == [
        "Dashboard - Candidate Dashboard Viewed"
    ]


def test_reconcile_watchlist_elevates_and_proposes():
    catalog = [
        {
            "event_type": "Dashboard - Tab Switched",
            "family": "win_dashboard",
            "is_win": True,
            "first_seen_date": date(2026, 6, 1),
            "last_seen_date": date(2026, 1, 1),
            "event_count": 5,
            "event_count_30d": 0,
            "govern_description": None,
            "in_govern_taxonomy": True,
        },
    ]
    code = {"Dashboard - Tab Switched": {"retired_date": "", "instrumented_pr": "#1"}}
    # On the watchlist: dormant becomes elevated (rank 6), and it is NOT re-proposed.
    result = eh.reconcile(
        catalog, [], code, TODAY,
        watchlist_events={"Dashboard - Tab Switched"},
        watched_families={"win_dashboard"},
    )
    rec = result["records"][0]
    assert rec["on_watchlist"] and rec["elevated"]
    assert rec["rank"] == 6  # dormant + elevated
    assert result["proposals"] == []  # already on the watchlist


# --- diff_flagged ------------------------------------------------------------


def test_diff_flagged_first_run_all_new():
    flagged = [{"event_type": "A", "status": "dormant"}, {"event_type": "B", "status": "orphaned_firing"}]
    assert eh.diff_flagged(flagged, None) == {
        "new": ["A", "B"],
        "resolved": [],
        "still_open": [],
        "escalated": [],
    }


def test_diff_flagged_against_prior():
    flagged = [{"event_type": "B", "status": "orphaned_firing"}, {"event_type": "C", "status": "dormant"}]
    prior = {"A": "dormant", "B": "orphaned_firing"}
    diff = eh.diff_flagged(flagged, prior)
    assert diff == {"new": ["C"], "resolved": ["A"], "still_open": ["B"], "escalated": []}


def test_diff_flagged_surfaces_status_escalation():
    # An event flagged in both runs whose status worsened must surface, not hide in still_open.
    flagged = [{"event_type": "B", "status": "orphaned_firing"}]
    prior = {"B": "dormant"}
    diff = eh.diff_flagged(flagged, prior)
    assert diff == {"new": [], "resolved": [], "still_open": [], "escalated": ["B"]}


# --- load_prior_state robustness ---------------------------------------------


def test_load_prior_state_tolerates_corrupt_json(tmp_path):
    p = tmp_path / "state.json"
    p.write_text("{truncated mid-write")
    assert eh.load_prior_state(p) is None


def test_load_prior_state_missing_flagged_key(tmp_path):
    p = tmp_path / "state.json"
    p.write_text('{"run_date": "2026-06-29"}')
    assert eh.load_prior_state(p) is None


def test_load_prior_state_reads_valid_flagged(tmp_path):
    p = tmp_path / "state.json"
    p.write_text('{"run_date": "2026-06-29", "flagged": {"A": "dormant"}}')
    assert eh.load_prior_state(p) == {"A": "dormant"}


# --- metadata coverage -------------------------------------------------------


def _cat(event_type, family, desc, cnt30=10):
    return {
        "event_type": event_type,
        "family": family,
        "is_win": True,
        "first_seen_date": None,
        "last_seen_date": date(2026, 6, 24),
        "event_count": 100,
        "event_count_30d": cnt30,
        "govern_description": desc,
        "in_govern_taxonomy": True,
    }


def test_reconcile_metadata_coverage():
    catalog = [
        _cat("Onboarding - Office Step", "win_onboarding", "Fires on the office step."),  # elevated, has desc
        _cat("Onboarding - Party Step", "win_onboarding", ""),  # elevated, missing -> listed first
        _cat("Dashboard - Tab", "win_dashboard", ""),  # not elevated, missing -> counted only
        _cat("page", "amplitude_autotrack", ""),  # system -> excluded from coverage
    ]
    code = {r["event_type"]: {"retired_date": "", "instrumented_pr": ""} for r in catalog}
    mc = eh.reconcile(catalog, [], code, TODAY)["metadata_coverage"]

    assert mc["scored"] == 3  # system 'page' excluded
    assert mc["with_description"] == 1
    assert mc["elevated_missing"] == ["Onboarding - Party Step"]
    assert mc["other_missing_count"] == 1  # Dashboard - Tab


# --- render_digest_section ---------------------------------------------------


def _flag(event_type, rank, status, **kw):
    base = {
        "event_type": event_type,
        "rank": rank,
        "status": status,
        "elevated": False,
        "event_count_30d": 0,
        "last_seen_date": None,
        "anomaly": None,
        "instrumented_pr": None,
        "divergence": None,
    }
    base.update(kw)
    return base


def test_render_collapses_dormant_tail_and_caps_changes():
    flagged = [
        _flag("Orphan", 1, "orphaned_firing", elevated=True, event_count_30d=9),
        _flag("Tail A", 8, "dormant"),
        _flag("Tail B", 8, "dormant"),
    ]
    result = {
        "run_date": date(2026, 6, 26),
        "current_week_basis": "complete weeks before 2026-06-22",
        "total_events": 100,
        "status_counts": {"active": 90, "dormant": 8, "orphaned_firing": 1, "system": 1},
        "metadata_coverage": {
            "scored": 60,
            "with_description": 45,
            "elevated_missing": ["Onboarding - Party Step"],
            "other_missing_count": 14,
        },
        "proposals": [{"event_type": "Onboarding - New Step", "family": "win_onboarding", "first_seen_date": date(2026, 6, 1)}],
        "flagged": flagged,
    }
    changes = {"new": [f"e{i}" for i in range(20)], "resolved": ["x"], "still_open": [], "escalated": []}
    out = eh.render_digest_section(result, changes)

    assert "## 2026-06-26" in out
    assert "1 priority, 2 dormant tail" in out
    # priority flag is a detailed table row; tail events are collapsed to one line
    assert "| 1 orphaned-firing" in out and "Orphan" in out
    assert "**Dormant tail (2)**" in out and "Tail A · Tail B" in out
    assert "Tail A |" not in out  # not a table row
    # changes cap: 20 > CHANGES_NAME_CAP summarizes, resolved stays explicit
    assert "- new: 20 (see flagged table)" in out
    assert "- resolved: x" in out
    # metadata completeness section
    assert "### Metadata completeness" in out
    assert "45/60 (75%)" in out
    assert "fill first): Onboarding - Party Step" in out
    assert "missing a description: 14 (not listed)" in out
    # self-healing proposals section, rendered as a ready-to-paste yaml row
    assert "### Watchlist proposals (self-healing)" in out
    assert '- {event: "Onboarding - New Step", product: win, family: win_onboarding' in out
