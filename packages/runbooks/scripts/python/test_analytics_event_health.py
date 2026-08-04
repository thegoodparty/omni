"""Unit tests for the analytics event health monitor pure logic (DATA-1952).

Pure functions only — no Databricks, no filesystem. Run from scripts/python with
``uv run pytest test_analytics_event_health.py``.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import analytics_event_health as eh

TODAY = date(2026, 6, 25)  # a Thursday; current (in-progress) week starts Mon 2026-06-22
MONDAY = date(2026, 6, 22)


# --- to_date -----------------------------------------------------------------


def test_health_sql_reads_mart_analytics_tables():
    # The reconcile tests inject pre-built data and never touch the SQL constants,
    # so without this a revert to the dbt relations would pass silently.
    assert "mart_analytics.amplitude_event_catalog" in eh.CATALOG_SQL
    assert "mart_analytics.amplitude_events" in eh.WEEKLY_SQL
    assert "dbt." not in eh.CATALOG_SQL
    assert "dbt." not in eh.WEEKLY_SQL


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


def test_parse_gpmeta_extracts_intent_date():
    not_in_use = "<!-- gp-meta -->\npurpose\nnot in use: 2026-05-05 (retired, #1790)\n<!-- /gp-meta -->"
    assert eh.parse_gpmeta(not_in_use)["intent_date"] == "2026-05-05"
    in_use = "<!-- gp-meta -->\npurpose\nin use: 2026-06-18 (#1)\n<!-- /gp-meta -->"
    assert eh.parse_gpmeta(in_use)["intent_date"] == "2026-06-18"
    dateless = "<!-- gp-meta -->\npurpose\nin use\n<!-- /gp-meta -->"
    meta = eh.parse_gpmeta(dateless)
    assert meta["intent"] == "in_use"
    assert meta["intent_date"] is None


def test_parse_gpmeta_extracts_purpose():
    desc = (
        "<!-- gp-meta -->\n"
        'Fired when user completes the "Pledge" step in Onboarding. |\n'
        "supersession: superseded by Onboarding V2 - Pledge Completed (rebuild) |\n"
        "not in use: 2026-05-05 (#1790)\n"
        "<!-- /gp-meta -->"
    )
    result = eh.parse_gpmeta(desc)
    assert result["purpose"] == 'Fired when user completes the "Pledge" step in Onboarding.'
    assert result["supersession"] == "superseded by Onboarding V2 - Pledge Completed (rebuild)"
    assert result["intent"] == "not_in_use"


def test_parse_gpmeta_purpose_none_when_block_has_no_prose_line():
    desc = "<!-- gp-meta -->\nsupersession: original |\nin use: 2026-06-16 (#171)\n<!-- /gp-meta -->"
    result = eh.parse_gpmeta(desc)
    assert result["purpose"] is None
    assert result["supersession"] == "original"


def test_parse_gpmeta_none_when_no_block():
    assert eh.parse_gpmeta("plain description, no markers") is None
    assert eh.parse_gpmeta(None) is None


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


def _classify(**kw):
    base = {"in_code": True, "firing_recent": True, "retired_date": None, "last_seen_date": None, "today": TODAY}
    base.update(kw)
    return eh.classify_status(**base)


def test_classify_status_branches():
    assert _classify(in_code=None) == "code_unknown"
    assert _classify(retired_date=None, firing_recent=True) == "active"
    assert _classify(retired_date=None, firing_recent=False) == "dormant"
    # code removed + firing after retirement -> orphaned
    assert _classify(retired_date=date(2026, 6, 1), firing_recent=True, last_seen_date=date(2026, 6, 24)) == "orphaned_firing"
    # code removed + firing but last_seen missing (data gap) -> ambiguous, fall back to firing -> orphaned
    assert _classify(retired_date=date(2026, 6, 1), firing_recent=True, last_seen_date=None) == "orphaned_firing"
    # code removed + last_seen missing but NOT firing -> still quiet, deprecating/retired
    assert _classify(retired_date=date(2026, 6, 20), firing_recent=False, last_seen_date=None) == "deprecating"
    # code removed, within 30d holding window, quiet -> deprecating
    assert _classify(retired_date=date(2026, 6, 20), firing_recent=False, last_seen_date=date(2026, 6, 19)) == "deprecating"
    # code removed, past the window, quiet -> retired
    assert _classify(retired_date=date(2026, 1, 1), firing_recent=False, last_seen_date=date(2025, 12, 30)) == "retired"


def test_classify_status_recent_retiree_quiet_before_retirement_not_orphaned():
    # DATA-2140: a nonzero 30-day count whose last fire predates retirement is NOT orphaned —
    # the window merely straddles the retirement date. Within 30d of retirement -> deprecating.
    assert (
        _classify(
            firing_recent=True, retired_date=date(2026, 6, 20), last_seen_date=date(2026, 6, 10)
        )
        == "deprecating"
    )


def test_classify_status_grace_window_absorbs_deploy_lag():
    # Firing exactly at / within the grace window after retirement is the expected deploy /
    # client-drain tail, not an orphan.
    assert (
        _classify(
            firing_recent=True,
            retired_date=date(2026, 6, 20),
            last_seen_date=date(2026, 6, 20) + timedelta(days=eh.ORPHAN_GRACE_DAYS),
        )
        == "deprecating"
    )
    # One day past the grace window -> genuine orphan.
    assert (
        _classify(
            firing_recent=True,
            retired_date=date(2026, 6, 20),
            last_seen_date=date(2026, 6, 20) + timedelta(days=eh.ORPHAN_GRACE_DAYS + 1),
        )
        == "orphaned_firing"
    )


# --- divergence / rank -------------------------------------------------------


def test_divergence_flags():
    assert eh.divergence({"intent": "not_in_use", "supersession": None}, "active", True).endswith(
        "still firing"
    )
    assert "code removed" in eh.divergence({"intent": "in_use", "supersession": None}, "retired", False)
    assert eh.divergence(None, "active", True) is None


def test_divergence_not_in_use_requires_firing_after_declaration():
    # DATA-2140 twin: "still firing" must mean fired AFTER the not-in-use declaration, not merely a
    # nonzero 30d count straddling that date.
    dated = {"intent": "not_in_use", "intent_date": "2026-06-20", "supersession": None}
    # last fire predates the declaration -> not still firing
    assert eh.divergence(dated, "active", True, last_seen_date=date(2026, 6, 10)) is None
    # fired after the declaration (past the grace) -> genuine divergence
    assert eh.divergence(dated, "active", True, last_seen_date=date(2026, 6, 25)).endswith("still firing")
    # within the grace window after declaration -> pipeline-lag tail, not a divergence
    assert eh.divergence(
        dated, "active", True, last_seen_date=date(2026, 6, 20) + timedelta(days=eh.ORPHAN_GRACE_DAYS)
    ) is None
    # last_seen missing (data gap) with a declaration date -> ambiguous, fall back to firing_recent
    assert eh.divergence(dated, "active", True, last_seen_date=None).endswith("still firing")
    # no declaration date -> cannot verify temporally, fall back to firing_recent
    undated = {"intent": "not_in_use", "intent_date": None, "supersession": None}
    assert eh.divergence(undated, "active", True, last_seen_date=date(2026, 6, 10)).endswith("still firing")


def test_rank_record_priority():
    def rec(**kw):
        base = {
            "status": "active", "elevated": False, "anomaly": None,
            "divergence": None, "call_site_count": None, "event_count_30d": 0,
        }
        base.update(kw)
        return base

    assert eh.rank_record(rec(status="active", call_site_count=0)) == 0
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


def test_rank_record_zero_calls_firing_normally_is_counter_blind_spot():
    # DATA-2106 canary: a client event cannot fire normally with zero call sites -- the data
    # axis contradicts the code axis, so the counter is blind (aliased/wrapped reference),
    # not the event dead. Rank 0 tooling alert, NOT the rank-2 retirement path. (Before
    # DATA-2106 this exact record fell through to 99 and the false zero sat silent in the CSV.)
    rec = {"status": "active", "elevated": False, "anomaly": None,
           "divergence": None, "call_site_count": 0, "event_count_30d": 50}
    assert eh.rank_record(rec) == 0


def test_rank_record_zero_calls_active_with_anomaly_stays_rank_2():
    # An anomaly drop alongside the zero is the signature of a GENUINE recent removal (count
    # falling as old clients drain) -- that stays on the rank-2 retirement path, not the canary.
    rec = {"status": "active", "elevated": False, "anomaly": {"current": 1, "baseline": 9},
           "divergence": None, "call_site_count": 0, "event_count_30d": 50}
    assert eh.rank_record(rec) == 2


def test_rank_record_null_call_sites_never_canary():
    # Backend / dynamic events (no resolvable key-path) have None, not zero: no canary.
    rec = {"status": "active", "elevated": False, "anomaly": None,
           "divergence": None, "call_site_count": None, "event_count_30d": 50}
    assert eh.rank_record(rec) == 99


def test_rank_label_covers_counter_blind_spot():
    assert eh._RANK_LABEL[0]


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


def test_propose_skips_dismissed_events():
    today = date(2026, 8, 3)
    catalog = [
        {"event_type": "Kept Proposal", "family": "win_onboarding",
         "event_count_30d": 10, "first_seen_date": "2026-07-20", "last_seen_date": "2026-08-01"},
        {"event_type": "Rejected Proposal", "family": "win_onboarding",
         "event_count_30d": 10, "first_seen_date": "2026-07-20", "last_seen_date": "2026-08-01"},
    ]
    out = eh.propose_watchlist_additions(
        catalog, code={}, watched_families=["win_onboarding"],
        watchlist_events=[], today=today, dismissed_events=["Rejected Proposal"],
    )
    names = {p["event_type"] for p in out}
    assert "Kept Proposal" in names
    assert "Rejected Proposal" not in names


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


def test_reconcile_stamps_watchlist_status():
    today = date(2026, 8, 3)
    catalog = [
        {"event_type": "Sign Up Clicked", "family": "win_onboarding", "govern_description": "",
         "event_count_30d": 5, "last_seen_date": "2026-08-01", "first_seen_date": "2024-01-01"},
        {"event_type": "Noise Event", "family": "win_onboarding", "govern_description": "",
         "event_count_30d": 5, "last_seen_date": "2026-08-01", "first_seen_date": "2026-07-20"},
        {"event_type": "Fresh Live Event", "family": "win_onboarding", "govern_description": "",
         "event_count_30d": 5, "last_seen_date": "2026-08-01", "first_seen_date": "2026-07-25"},
        {"event_type": "Old Untracked", "family": "win_onboarding", "govern_description": "",
         "event_count_30d": 5, "last_seen_date": "2026-08-01", "first_seen_date": "2020-01-01"},
    ]
    result = eh.reconcile(
        catalog, weekly_rows=[], code={}, today=today,
        watchlist_events=["Sign Up Clicked"], watched_families=["win_onboarding"],
        dismissed_events=["Noise Event"],
    )
    status = {r["event_type"]: r["watchlist_status"] for r in result["records"]}
    assert status["Sign Up Clicked"] == "tracked"
    assert status["Noise Event"] == "dismissed"
    assert status["Fresh Live Event"] == "proposed"
    assert status["Old Untracked"] == "—"


def test_reconcile_recent_retiree_quiet_before_retirement_is_not_orphaned():
    # DATA-2140 regression: an event whose LAST fire predates its retirement is retired-and-quiet,
    # not orphaned. The 30-day count straddles the retirement date (126 fires, all pre-retirement),
    # which must NOT read as post-retirement firing. Expected: deprecating (within the 30d holding
    # window), and NOT flagged. This is the PR #732 bulk-retirement false-positive.
    today = date(2026, 7, 16)
    catalog = [
        {
            "event_type": "Dashboard - Campaign Plan: Community Events Displayed",
            "family": "win_dashboard", "is_win": True,
            "first_seen_date": date(2026, 1, 1), "last_seen_date": date(2026, 6, 27),
            "event_count": 5000, "event_count_30d": 126,
            "govern_description": None, "in_govern_taxonomy": True,
        },
    ]
    code = {
        "Dashboard - Campaign Plan: Community Events Displayed": {
            "retired_date": "2026-07-13", "instrumented_pr": "#700", "retired_pr": "#732",
        },
    }
    result = eh.reconcile(catalog, [], code, today)
    rec = result["records"][0]
    assert rec["status"] == "deprecating"
    assert [r["event_type"] for r in result["flagged"]] == []


def test_reconcile_genuine_orphan_fires_after_retirement():
    # Control: an event STILL firing after its code was removed (stale clients emitting the old
    # half of a rename) is a real orphan. last_seen is well past retirement -> orphaned_firing,
    # flagged rank 1.
    today = date(2026, 7, 16)
    catalog = [
        {
            "event_type": "Old Rename Half",
            "family": "win_voter_data", "is_win": True,
            "first_seen_date": date(2026, 1, 1), "last_seen_date": date(2026, 7, 15),
            "event_count": 5000, "event_count_30d": 300,
            "govern_description": None, "in_govern_taxonomy": True,
        },
    ]
    code = {"Old Rename Half": {"retired_date": "2026-06-01", "instrumented_pr": "#1"}}
    result = eh.reconcile(catalog, [], code, today)
    rec = result["records"][0]
    assert rec["status"] == "orphaned_firing"
    assert rec["rank"] == 1


def test_reconcile_not_in_use_quiet_before_declaration_no_divergence():
    # DATA-2140 twin on the gp-meta intent axis: an event declared not-in-use on 2026-07-01 whose
    # last fire (2026-06-25) predates that declaration is NOT "still firing" — the 30d count merely
    # straddles the declaration date. Must yield no divergence and not flag at rank 1.
    today = date(2026, 7, 16)
    desc = "<!-- gp-meta -->\npurpose line\nnot in use: 2026-07-01 (#123)\n<!-- /gp-meta -->"
    catalog = [
        {
            "event_type": "Legacy Step Completed",
            "family": "win_dashboard", "is_win": True,
            "first_seen_date": date(2026, 1, 1), "last_seen_date": date(2026, 6, 25),
            "event_count": 5000, "event_count_30d": 50,
            "govern_description": desc, "in_govern_taxonomy": True,
        },
    ]
    code = {"Legacy Step Completed": {"retired_date": "", "instrumented_pr": "#1"}}
    result = eh.reconcile(catalog, [], code, today)
    rec = result["records"][0]
    assert rec["divergence"] is None
    assert [r["event_type"] for r in result["flagged"]] == []


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


# --- load_prior_anomalous robustness (DATA-2057) -----------------------------


def test_load_prior_anomalous_tolerates_corrupt_json(tmp_path):
    p = tmp_path / "state.json"
    p.write_text("{truncated mid-write")
    assert eh.load_prior_anomalous(p) is None


def test_load_prior_anomalous_missing_key_returns_none(tmp_path):
    # Pre-existing state file written before this PR has no 'anomalous' key.
    p = tmp_path / "state.json"
    p.write_text('{"run_date": "2026-06-29", "flagged": {"A": "dormant"}}')
    assert eh.load_prior_anomalous(p) is None


def test_load_prior_anomalous_reads_valid_list(tmp_path):
    p = tmp_path / "state.json"
    p.write_text('{"run_date": "2026-06-29", "anomalous": ["B", "C"]}')
    assert eh.load_prior_anomalous(p) == {"B", "C"}


# --- load_watchlist ----------------------------------------------------------


def test_load_watchlist_reads_dismissed(tmp_path):
    p = tmp_path / "mon.yaml"
    p.write_text(
        "watched_families: [win_onboarding]\n"
        'events:\n  - {event: "Sign Up Clicked", product: win, family: win_onboarding}\n'
        'dismissed:\n  - {event: "Noise Event", reason: "UI micro-interaction", date: "2026-08-03"}\n'
    )
    families, events, dismissed, okr = eh.load_watchlist(p)
    assert families == ["win_onboarding"]
    assert events == ["Sign Up Clicked"]
    assert dismissed == ["Noise Event"]
    assert okr == {}


def test_load_watchlist_returns_okr_map(tmp_path):
    y = tmp_path / "w.yaml"
    y.write_text(
        "watched_families: [win_dashboard]\n"
        "events:\n"
        '  - {event: "Dashboard - Candidate Dashboard Viewed", product: win, '
        'family: win_dashboard, floor: null, owner: TBD, okr: "Active Candidates"}\n'
        '  - {event: "Sign Up Clicked", product: win, family: win_onboarding, '
        "floor: null, owner: TBD}\n"
        '  - {event: "Multi Metric Event", product: win, family: win_dashboard, '
        'floor: null, owner: TBD, okr: ["Active Candidates", "Signups"]}\n'
        "dismissed: []\n"
    )
    families, events, dismissed, okr = eh.load_watchlist(y)
    assert events == [
        "Dashboard - Candidate Dashboard Viewed", "Sign Up Clicked", "Multi Metric Event",
    ]
    assert okr == {
        "Dashboard - Candidate Dashboard Viewed": "Active Candidates",
        "Multi Metric Event": "Active Candidates, Signups",
    }


def test_load_watchlist_missing_file_returns_empty_okr(tmp_path):
    assert eh.load_watchlist(tmp_path / "absent.yaml") == ([], [], [], {})


def test_reconcile_stamps_okr_on_records():
    catalog = [{
        "event_type": "Dashboard - Candidate Dashboard Viewed", "family": "win_dashboard",
        "govern_description": None, "event_count_30d": 0, "last_seen_date": None,
    }]
    result = eh.reconcile(
        catalog, weekly_rows=[], code={}, today=date(2026, 8, 4),
        watchlist_events=["Dashboard - Candidate Dashboard Viewed"],
        watched_families=["win_dashboard"],
        okr_by_event={"Dashboard - Candidate Dashboard Viewed": "Active Candidates"},
    )
    rec = result["records"][0]
    assert rec["okr"] == "Active Candidates"
    assert rec["on_watchlist"] is True


# --- prepend_log -------------------------------------------------------------

HEADER = "# Analytics event-health log\n\nPreamble.\n\n## Status legend\n\n| a | b |\n"


def test_prepend_log_inserts_below_header_above_prior_runs(tmp_path):
    p = tmp_path / "log.md"
    p.write_text(HEADER + "\n## 2026-06-26\n\nolder digest\n")
    eh.prepend_log(p, "## 2026-07-13\n\nnewer digest\n")
    text = p.read_text()
    assert text.startswith(HEADER)
    assert text.index("## 2026-07-13") < text.index("## 2026-06-26")
    # one blank line between the new section and the prior newest
    assert "newer digest\n\n## 2026-06-26" in text


def test_prepend_log_appends_when_no_dated_section(tmp_path):
    p = tmp_path / "log.md"
    p.write_text(HEADER)
    eh.prepend_log(p, "## 2026-07-13\n\nfirst digest\n")
    assert p.read_text() == HEADER + "\n## 2026-07-13\n\nfirst digest\n"


def test_prepend_log_creates_missing_file(tmp_path):
    p = tmp_path / "log.md"
    eh.prepend_log(p, "## 2026-07-13\n\nfirst digest\n")
    assert p.read_text() == "## 2026-07-13\n\nfirst digest\n"


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
        "call_site_count": None,
        "call_site_retired_date": None,
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


def test_render_shows_call_site_removed_evidence():
    # DATA-2046: the rank-2 row must render the call_sites=0 evidence (the primary new behavior)
    # in the digest, not just be assigned the rank in reconcile.
    flagged = [
        _flag(
            "Dashboard - Candidate Dashboard Viewed",
            2,
            "dormant",
            call_site_count=0,
            call_site_retired_date="2026-06-13",
        ),
    ]
    result = {
        "run_date": date(2026, 6, 26),
        "current_week_basis": "complete weeks before 2026-06-22",
        "total_events": 50,
        "status_counts": {"dormant": 1},
        "flagged": flagged,
    }
    changes = {"new": [], "resolved": [], "still_open": [], "escalated": []}
    out = eh.render_digest_section(result, changes)

    assert "| 2 call site removed, name constant remains |" in out
    assert "Dashboard - Candidate Dashboard Viewed" in out
    assert "call_sites=0 (removed 2026-06-13)" in out


# --- main --gap-slack (DATA-2151 Task 6) -------------------------------------


def _stub_run_monitor(*_args, **_kwargs):
    result = {
        "run_date": "2026-07-21",
        "current_week_basis": "complete weeks before 2026-07-21",
        "flagged": [],
        "status_counts": {},
        "total_events": 0,
    }
    changes = {"new": [], "escalated": [], "resolved": [], "still_open": []}
    return result, changes


def test_main_passes_gap_slack_to_post_digest(monkeypatch, tmp_path):
    monkeypatch.setattr(eh, "run_monitor", _stub_run_monitor)
    import event_state_slack as slk

    captured = {}
    monkeypatch.setattr(slk, "post_digest", lambda *a, **k: captured.update(k) or "1.1")
    monkeypatch.setenv(slk.TOKEN_ENV, "t")
    monkeypatch.setenv(slk.CHANNEL_ENV, "c")

    gap_file = tmp_path / "gap.json"
    gap_file.write_text(
        json.dumps(
            {
                "new_count": 2,
                "status": "ok",
                "pending_count": 0,
                "new_gaps": [],
                "browse_url": None,
                "feedback_url": None,
            }
        )
    )
    rc = eh.main(
        [
            "--no-log",
            "--slack",
            "--gap-slack",
            str(gap_file),
            "--today",
            "2026-07-21",
            "--state",
            str(tmp_path / "s.json"),
        ]
    )
    assert rc == 0
    assert captured.get("gap", {}).get("new_count") == 2


def test_main_gap_slack_missing_file_is_graceful(monkeypatch, tmp_path):
    monkeypatch.setattr(eh, "run_monitor", _stub_run_monitor)
    import event_state_slack as slk

    captured = {}
    monkeypatch.setattr(slk, "post_digest", lambda *a, **k: captured.update(k) or None)
    monkeypatch.setenv(slk.TOKEN_ENV, "t")
    monkeypatch.setenv(slk.CHANNEL_ENV, "c")

    rc = eh.main(
        [
            "--no-log",
            "--slack",
            "--gap-slack",
            str(tmp_path / "nope.json"),
            "--today",
            "2026-07-21",
            "--state",
            str(tmp_path / "s.json"),
        ]
    )
    assert rc == 0
    assert captured.get("gap") is None
