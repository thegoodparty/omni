"""Unit tests for the analytics event health monitor pure logic (DATA-1952).

Pure functions only — no Databricks, no filesystem. Run from scripts/python with
``uv run pytest test_analytics_event_health.py``.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import analytics_event_health as eh
import sem_anchors as sa

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


def test_parse_gpmeta_none_only_when_description_is_empty():
    assert eh.parse_gpmeta(None) is None
    assert eh.parse_gpmeta("") is None
    assert eh.parse_gpmeta("   \n  ") is None


def test_parse_gpmeta_prose_only_description_is_the_purpose():
    # DATA-2426 regression: 193 events carry a good prose description in Amplitude and
    # no gp-meta block. They rendered an empty description cell in the sheet.
    meta = eh.parse_gpmeta("Fired when a candidate publishes their website.")
    assert meta is not None
    assert meta["purpose"] == "Fired when a candidate publishes their website."
    assert meta["intent"] is None
    assert meta["intent_date"] is None
    assert meta["supersession"] is None


def test_parse_gpmeta_prose_only_collapses_multiline_to_one_line():
    meta = eh.parse_gpmeta("Fired on publish.\n\nCounts once per campaign.\n")
    assert meta["purpose"] == "Fired on publish. Counts once per campaign."


def test_parse_gpmeta_block_without_purpose_line_falls_back_to_prose_outside():
    desc = (
        "Fired when a member submits an issue.\n"
        "<!-- gp-meta -->\n"
        "supersession: original |\n"
        "in use: 2026-06-16 (#171)\n"
        "<!-- /gp-meta -->\n"
    )
    meta = eh.parse_gpmeta(desc)
    assert meta["purpose"] == "Fired when a member submits an issue."
    assert meta["intent"] == "in_use"


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


def test_parse_gpmeta_purpose_none_when_block_has_no_prose_line_and_no_prose_outside():
    desc = "<!-- gp-meta -->\nsupersession: original |\nin use: 2026-06-16 (#171)\n<!-- /gp-meta -->"
    result = eh.parse_gpmeta(desc)
    assert result["purpose"] is None
    assert result["supersession"] == "original"


def test_parse_gpmeta_extracts_fires_on_and_url():
    desc = (
        "<!-- gp-meta -->\n"
        "Confirms an admin approved a campaign for sending. |\n"
        "fires_on: Admin SMS outreach queue, Approve & book send on a campaign detail page. |\n"
        "url: /dashboard/sms-outreach/:id (gp-admin) |\n"
        "supersession: original |\n"
        "in use: 2026-09-09 (#1)\n"
        "<!-- /gp-meta -->"
    )
    meta = eh.parse_gpmeta(desc)
    assert meta["fires_on"] == (
        "Admin SMS outreach queue, Approve & book send on a campaign detail page."
    )
    assert meta["url"] == "/dashboard/sms-outreach/:id (gp-admin)"
    assert meta["purpose"] == "Confirms an admin approved a campaign for sending."


def test_parse_gpmeta_anchor_fields_absent_are_none():
    desc = "<!-- gp-meta -->\npurpose line\nin use: 2026-06-18 (#1)\n<!-- /gp-meta -->"
    meta = eh.parse_gpmeta(desc)
    assert meta["fires_on"] is None
    assert meta["url"] is None
    meta = eh.parse_gpmeta("prose only, no block")
    assert meta["fires_on"] is None
    assert meta["url"] is None


def test_parse_gpmeta_anchor_line_above_the_prose_is_not_mistaken_for_the_purpose():
    desc = (
        "<!-- gp-meta -->\n"
        "fires_on: Campaign plan page, Generate button. |\n"
        "The question this event answers. |\n"
        "in use: 2026-09-09 (#1)\n"
        "<!-- /gp-meta -->"
    )
    assert eh.parse_gpmeta(desc)["purpose"] == "The question this event answers."


def test_parse_gpmeta_purpose_starting_with_the_word_url_survives():
    desc = "<!-- gp-meta -->\nURL of the shared plan was opened. |\nin use: 2026-09-09\n<!-- /gp-meta -->"
    assert eh.parse_gpmeta(desc)["purpose"] == "URL of the shared plan was opened."


def test_parse_gpmeta_prose_only_does_not_raise_a_divergence():
    # The fallback must not turn 193 undeclared events into intent-vs-reality flags.
    meta = eh.parse_gpmeta("A plain prose description, no markers.")
    assert eh.divergence(meta, "retired", firing_recent=False) is None
    assert eh.divergence(meta, "active", firing_recent=True) is None


def test_parse_gpmeta_unclosed_marker_does_not_leak_markup_into_the_purpose():
    # A hand-edit in the Amplitude Govern UI is exactly how a marker breaks. Without the
    # closing marker, GPMETA.search misses and the whole raw description — including the
    # opening marker and field lines — would otherwise become the purpose. Worst case
    # degrades to the pre-DATA-2426 blank cell, never a garbled one.
    desc = "Real prose here.\n<!-- gp-meta -->\nfires_on: Admin page. |\nin use: 2026-01-01 (#1)\n"
    meta = eh.parse_gpmeta(desc)
    assert meta["purpose"] == "Real prose here."
    assert "gp-meta" not in meta["purpose"]
    assert "fires_on" not in meta["purpose"]


def test_parse_gpmeta_supersession_substring_inside_fires_on_does_not_hijack_the_field():
    # The supersession regex was unanchored, so a "supersession:" substring anywhere in the
    # block — including inside another field's free-prose value — used to win over the real
    # supersession line further down.
    desc = (
        "<!-- gp-meta -->\n"
        "fires_on: Page X, supersession: nope |\n"
        "The purpose line. |\n"
        "supersession: original |\n"
        "in use: 2026-09-09 (#1)\n"
        "<!-- /gp-meta -->"
    )
    meta = eh.parse_gpmeta(desc)
    assert meta["supersession"] == "original"
    assert meta["fires_on"] == "Page X, supersession: nope"


def test_parse_gpmeta_url_field_name_collision_with_url_prefixed_purpose():
    # Accepted tradeoff, not a bug: the skip regex for the purpose scan requires a colon so
    # that a colon-less purpose line like "URL of the shared plan…" survives (see
    # test_parse_gpmeta_purpose_starting_with_the_word_url_survives above). The unavoidable
    # other side is that a purpose line that itself begins "URL:" is read as the `url` field
    # instead of the purpose.
    desc = "<!-- gp-meta -->\nURL: the shared plan link was opened. |\nin use: 2026-09-09\n<!-- /gp-meta -->"
    meta = eh.parse_gpmeta(desc)
    assert meta["purpose"] is None
    assert meta["url"] == "the shared plan link was opened."


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


def test_rank_record_zero_calls_firing_only_before_removal_is_not_canary():
    # DATA-2427: the canary's premise ("a client event cannot fire normally with zero call
    # sites") breaks when the 30-day window STRADDLES the call site's removal -- the firing is
    # all pre-removal traffic, so the zero is a genuine retirement, not a blind counter. Same
    # straddle trap DATA-2140 fixed for orphaned_firing, now on call_site_retired_date. Without
    # this gate a single flag-removal PR posts a burst of false rank-0 tooling alerts.
    rec = {"status": "active", "elevated": False, "anomaly": None, "divergence": None,
           "call_site_count": 0, "event_count_30d": 1883,
           "call_site_retired_date": "2026-09-08", "last_seen_date": "2026-09-09"}
    assert eh.rank_record(rec) == 2


def test_rank_record_zero_calls_firing_after_removal_stays_canary():
    # Firing that continues well past the removal is the real contradiction: the counter is
    # blind, or the event fires from somewhere the scan cannot see. Still rank 0.
    rec = {"status": "active", "elevated": False, "anomaly": None, "divergence": None,
           "call_site_count": 0, "event_count_30d": 1883,
           "call_site_retired_date": "2026-09-01", "last_seen_date": "2026-09-09"}
    assert eh.rank_record(rec) == 0


def test_rank_record_zero_calls_with_no_removal_date_stays_canary():
    # No attributable removal at all -> nothing to straddle -> the canary still fires.
    rec = {"status": "active", "elevated": False, "anomaly": None, "divergence": None,
           "call_site_count": 0, "event_count_30d": 50,
           "call_site_retired_date": None, "last_seen_date": "2026-09-09"}
    assert eh.rank_record(rec) == 0


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
    families, events, dismissed = eh.load_watchlist(p)
    assert families == ["win_onboarding"]
    assert events == ["Sign Up Clicked"]
    assert dismissed == ["Noise Event"]


def test_load_watchlist_ignores_queue_c_dismissals(tmp_path):
    p = tmp_path / "mon.yaml"
    p.write_text(
        "watched_families: [win_onboarding]\n"
        "events: []\n"
        "dismissed:\n"
        '  - {event: "B Row", reason: "r", date: "2026-08-06"}\n'
        '  - {event: "Viewed[path=/polls]", reason: "r", date: "2026-09-23", '
        "metric: win_active_candidates_30d}\n"
    )
    _, _, dismissed = eh.load_watchlist(p)
    assert dismissed == ["B Row"]


def test_load_watchlist_ignores_any_okr_key(tmp_path):
    y = tmp_path / "w.yaml"
    y.write_text(
        "watched_families: [win_dashboard]\n"
        "events:\n"
        '  - {event: "Sign Up Clicked", product: win, family: win_onboarding, okr: "Legacy"}\n'
        "dismissed: []\n"
    )
    assert eh.load_watchlist(y) == (["win_dashboard"], ["Sign Up Clicked"], [])


def test_load_watchlist_missing_file_returns_empty(tmp_path):
    assert eh.load_watchlist(tmp_path / "absent.yaml") == ([], [], [])


# --- load_monitored_events ---------------------------------------------------

BEHAVIOR_YAML = (
    "watched_families: [win_dashboard]\n"
    "events:\n"
    '  - {event: "Sign Up Clicked", product: win, family: win_onboarding}\n'
    "behaviors:\n"
    "  - id: voter_file_exported\n"
    "    product: win\n"
    "    surfaces:\n"
    '      - {path: a.tsx, label: crm, instrumented_by: "Voter Data - List Exported"}\n'
    "      - {path: b.tsx, label: wizard, instrumented_by: null}\n"
    "  - id: voter_outreach_scheduled\n"
    "    product: win\n"
    '    metric: win_activated_users\n'
    "    surfaces:\n"
    '      - {path: c.tsx, label: campaign, '
    'instrumented_by: "Voter Outreach - Campaign Completed"}\n'
    '      - {path: d.tsx, label: doors, instrumented_by: "Door Knocking - List Created"}\n'
)


def test_load_monitored_events_adds_behavior_instruments(tmp_path):
    y = tmp_path / "w.yaml"
    y.write_text(BEHAVIOR_YAML)
    _, events, _ = eh.load_monitored_events(y)
    assert events == [
        "Sign Up Clicked",
        "Voter Data - List Exported",
        "Voter Outreach - Campaign Completed",
        "Door Knocking - List Created",
    ]


def test_load_watchlist_stays_blind_to_behaviors(tmp_path):
    """Rule 8 compares instrumented_by against this list, so widening it in place would
    turn every migrated behavior into a duplicate-anchor error."""
    y = tmp_path / "w.yaml"
    y.write_text(BEHAVIOR_YAML)
    _, events, _ = eh.load_watchlist(y)
    assert events == ["Sign Up Clicked"]


def test_load_monitored_events_enrolls_a_page_path_surface_by_leg_key(tmp_path):
    """The surface means the '/dashboard' slice, not the site-wide event. Enrolling the
    bare name would mark the catalog record watchlisted, and so elevated, forever."""
    y = tmp_path / "w.yaml"
    y.write_text(
        "behaviors:\n"
        "  - id: dashboard_viewed\n"
        "    product: win\n"
        "    surfaces:\n"
        '      - {path: a.tsx, label: dash, instrumented_by: "Viewed", '
        'page_path: "/dashboard"}\n'
    )
    _, events, _ = eh.load_monitored_events(y)
    assert "Viewed[path=/dashboard]" in events
    assert "Viewed" not in events


def test_load_monitored_events_missing_file_returns_empty(tmp_path):
    assert eh.load_monitored_events(tmp_path / "absent.yaml") == ([], [], [])


def test_reconcile_stamps_okr_on_records():
    catalog = [{
        "event_type": "Dashboard - Candidate Dashboard Viewed", "family": "win_dashboard",
        "govern_description": None, "event_count_30d": 0, "last_seen_date": None,
    }]
    result = eh.reconcile(
        catalog, weekly_rows=[], code={}, today=date(2026, 8, 4),
        watchlist_events=["Dashboard - Candidate Dashboard Viewed"],
        watched_families=["win_dashboard"],
        okr_by_event={"Dashboard - Candidate Dashboard Viewed": "win_active_candidates_30d"},
    )
    rec = result["records"][0]
    assert rec["okr"] == "win_active_candidates_30d"
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


def _digest(flagged, **overrides):
    result = {
        "run_date": date(2026, 6, 26),
        "current_week_basis": "complete weeks before 2026-06-22",
        "total_events": 100,
        "status_counts": {"active": 90},
        "metadata_coverage": None,
        "proposals": [],
        "flagged": flagged,
    }
    result.update(overrides)
    changes = {"new": [], "resolved": [], "still_open": [], "escalated": []}
    return eh.render_digest_section(result, changes)


def test_cause_key_splits_call_site_removals_by_deploy():
    # Two deploys that each stranded a batch of name constants are two decisions. One
    # deploy is one decision however many events it stranded, which is the whole point
    # of counting causes rather than events.
    sept1 = _flag("A", 2, "dormant", call_site_count=0, call_site_retired_date="2026-09-01")
    sept8 = _flag("B", 2, "dormant", call_site_count=0, call_site_retired_date="2026-09-08")
    assert eh.cause_key(sept1) == "call_site_removed@2026-09-01"
    assert eh.cause_key(sept1) != eh.cause_key(sept8)
    assert eh.cause_label(eh.cause_key(sept1)) == "call sites removed on 2026-09-01"


def test_cluster_flagged_orders_by_rank_then_size_and_keeps_elevated_visible():
    flagged = [
        _flag("Orphan", 1, "orphaned_firing"),
        _flag("Gone A", 2, "dormant", call_site_count=0, call_site_retired_date="2026-09-01"),
        _flag("Gone B", 2, "dormant", call_site_count=0, call_site_retired_date="2026-09-01"),
        _flag("Gone C", 2, "dormant", call_site_count=0, call_site_retired_date="2026-09-01", elevated=True),
    ]
    clusters = eh.cluster_flagged(flagged)
    assert [c["cause"] for c in clusters] == ["orphaned_firing", "call_site_removed@2026-09-01"]
    assert [c["count"] for c in clusters] == [1, 3]
    # An OKR-adjacent event must never be legible only as part of a number.
    assert clusters[1]["elevated"] == ["Gone C"]


def test_render_groups_by_cause_and_keeps_per_event_detail_collapsed():
    flagged = [
        _flag("Gone A", 2, "dormant", call_site_count=0, call_site_retired_date="2026-09-01"),
        _flag("Gone B", 2, "dormant", call_site_count=0, call_site_retired_date="2026-09-01"),
    ]
    out = _digest(flagged)
    assert "### Flagged (by cause)" in out
    assert "**call sites removed on 2026-09-01** — 2 event(s)" in out
    assert "Gone A · Gone B" in out
    # The log is the longitudinal record, so the rows survive; they are just folded away.
    assert "<details><summary>Per-event detail (2)</summary>" in out
    assert "| Gone A |" in out
    assert "2 priority in 1 cause(s)" in out


def test_render_routes_counter_blind_spots_out_of_the_queue():
    # Our call-site counter failing to see a reference is a bug in our tooling. It ranks
    # 0 for visibility but it is not a product finding, and it must not compete with one.
    canary = _flag("Aliased", 0, "active", call_site_count=0, event_count_30d=2167)
    real = _flag("Orphan", 1, "orphaned_firing")
    out = _digest([canary, real])
    assert "### Counter blind spots (our tooling, not the product)" in out
    assert "1 event(s) fire normally with zero counted call sites" in out
    causes = out.split("### Flagged (by cause)")[1].split("<details>")[0]
    assert "Aliased" not in causes
    assert "declared not-in-use, still firing" in causes
    assert "1 priority in 1 cause(s), 1 counter blind spot(s)" in out


def test_render_strikes_through_a_dismissed_cause_but_still_counts_it():
    # Silenced, never deleted: a cluster someone waved through that keeps growing has to
    # stay visible, or the dismissal becomes the next blind spot.
    flagged = [
        _flag("Gone A", 2, "dormant", call_site_count=0,
              call_site_retired_date="2026-09-01", dismissed_cause="retired with the flow"),
        _flag("Gone B", 2, "dormant", call_site_count=0,
              call_site_retired_date="2026-09-01", dismissed_cause="retired with the flow"),
    ]
    out = _digest(flagged)
    assert "~~call sites removed on 2026-09-01~~ — 2 event(s), dismissed: retired with the flow" in out
    assert "| Gone A |" in out  # still in the per-event detail


def test_load_cause_dismissals_reads_only_cause_rows(tmp_path):
    path = tmp_path / "monitored_events.yaml"
    path.write_text(
        "dismissed:\n"
        "  - {cause: 'call_site_removed@2026-09-01', reason: 'retired with the flow'}\n"
        "  - {event: 'Some Event', reason: 'UI micro-interaction'}\n"
        "  - {event: 'Other', metric: 'win_activated_users', reason: 'overclaims'}\n"
    )
    dismissals, problems = eh.load_cause_dismissals(path)
    assert dismissals == {"call_site_removed@2026-09-01": "retired with the flow"}
    assert problems == []
    # The proposal queue and Queue C keep their own dismissal shapes, untouched.
    assert eh.load_watchlist(path)[2] == ["Some Event"]


def test_load_cause_dismissals_refuses_to_silence_a_latched_okr_anchor(tmp_path):
    # The rule was written in the runbook and the triage skill. Prose is one YAML edit
    # away from being ignored, and the edit that ignores it silences exactly the alert
    # this whole loop exists for: a number the company steers by going quiet.
    path = tmp_path / "monitored_events.yaml"
    path.write_text(
        "dismissed:\n"
        "  - {cause: 'okr_anchor_dormant', reason: 'noisy'}\n"
        "  - {cause: 'counter_blind_spot', reason: 'our bug'}\n"
        "  - {cause: 'orphaned_firing', reason: 'content builder is gone'}\n"
    )
    dismissals, problems = eh.load_cause_dismissals(path)
    assert dismissals == {"orphaned_firing": "content builder is gone"}
    assert len(problems) == 2
    assert all("cannot be dismissed" in p for p in problems)


def test_digest_says_so_when_a_dismissal_was_refused():
    out = _digest([_flag("Orphan", 1, "orphaned_firing")],
                  dismissal_problems=["`okr_anchor_dormant` cannot be dismissed; ignored."])
    assert "> **Dismissal refused.** `okr_anchor_dormant` cannot be dismissed" in out


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
    assert "1 priority in 1 cause(s), 2 dormant tail" in out
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


def test_no_log_does_not_rewrite_the_tracked_state_file(monkeypatch, tmp_path):
    # instrumentation_data/analytics_event_health_state.json is git-tracked and authored
    # by the scheduled run. A local `--no-log` used to rewrite it anyway, dirtying a
    # shared checkout with a diff that then has to be reverted by hand. --no-log means
    # "this run leaves nothing behind", so the state write goes with the log write. The
    # scheduled workflow does not pass --no-log, so the cron still advances the diff and
    # still persists the latches' sticky references.
    monkeypatch.setattr(eh, "run_monitor", _stub_run_monitor)
    state = tmp_path / "s.json"
    state.write_text('{"run_date": "2026-07-14", "flagged": {}, "latches": {}}\n')

    assert eh.main(["--no-log", "--today", "2026-07-21", "--state", str(state)]) == 0

    assert json.loads(state.read_text())["run_date"] == "2026-07-14", (
        "--no-log must leave the cron-authored state file byte-identical"
    )


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


def test_build_slack_triage_quiet_run_returns_none_with_empty_items(monkeypatch):
    # Quiet run: run_triage is invoked but with zero items, so its no-items early
    # return keeps the API untouched (covered by test_run_triage_no_items) and the
    # gate then suppresses the post.
    seen_items = []
    monkeypatch.setattr(
        "digest_triage.run_triage",
        lambda items, **kw: seen_items.append(list(items)) or {"status": "no-items", "items": items},
    )
    result = {"run_date": date(2026, 8, 4), "flagged": [], "proposals": [],
              "status_counts": {}, "total_events": 0}
    changes = {"new": [], "escalated": [], "resolved": [], "still_open": []}
    triage = eh.build_slack_triage(result, changes, state_path=None, gap=None)
    assert triage is None and seen_items == [[]]


def test_build_slack_triage_runs_on_changes(monkeypatch):
    monkeypatch.setattr(
        "digest_triage.run_triage", lambda items, **kw: {"status": "ok", "items": items})
    result = {"run_date": date(2026, 8, 4), "proposals": [], "status_counts": {},
              "total_events": 1, "flagged": [{
                  "event_type": "A", "status": "dormant", "rank": 8, "okr": None,
                  "on_watchlist": False, "elevated": False, "anomaly": None,
                  "event_count_30d": 0, "last_seen_date": None, "instrumented_pr": None,
                  "divergence": None, "gpmeta": None}]}
    changes = {"new": ["A"], "escalated": [], "resolved": [], "still_open": []}
    triage = eh.build_slack_triage(result, changes, state_path=None, gap=None)
    assert triage is not None and triage["items"][0]["event_type"] == "A"


def test_build_slack_triage_drops_canaries_and_dismissed_causes(monkeypatch):
    # Slack is the surface one person reads on a Monday. A bug in our own counter and a
    # cause already ruled on are not decisions, and they crowd out the ones that are.
    # Both stay in the digest and the JSON report, which is where the audit trail lives.
    monkeypatch.setattr(
        "digest_triage.run_triage", lambda items, **kw: {"status": "ok", "items": items})
    base = {"okr": None, "on_watchlist": False, "elevated": False, "anomaly": None,
            "last_seen_date": None, "instrumented_pr": None, "divergence": None,
            "gpmeta": None, "call_site_retired_date": None}
    canary = {**base, "event_type": "Aliased", "status": "active", "rank": 0,
              "call_site_count": 0, "event_count_30d": 2167}
    settled = {**base, "event_type": "Gone", "status": "dormant", "rank": 2,
               "call_site_count": 0, "event_count_30d": 0,
               "dismissed_cause": "retired with the flow"}
    real = {**base, "event_type": "Orphan", "status": "orphaned_firing", "rank": 1,
            "call_site_count": None, "event_count_30d": 9}
    result = {"run_date": date(2026, 8, 4), "proposals": [], "status_counts": {},
              "total_events": 3, "flagged": [canary, settled, real]}
    changes = {"new": ["Aliased", "Gone", "Orphan"], "escalated": [], "resolved": [],
               "still_open": []}
    triage = eh.build_slack_triage(result, changes, state_path=None, gap=None)
    assert [i["event_type"] for i in triage["items"]] == ["Orphan"]
    # Not mutated: the caller's result still carries everything for the digest + report.
    assert len(result["flagged"]) == 3


# --- path-qualified legs (DATA-2421 Part B) -----------------------------------


def test_path_weekly_sql_filters_the_page_path_not_just_the_event():
    legs = [sa.Leg("Viewed", "/dashboard", None)]
    sql = eh.build_path_weekly_sql(legs)
    # The event predicate and the path predicate must be ANDed inside one clause — an OR
    # would return every 'Viewed' row (4.46M) instead of the ~106k '/dashboard' slice,
    # inflating the leg's counts and masking a real break. Asserting the two substrings
    # separately (the old form of this test) can't catch that swap.
    assert "(event_type = 'Viewed' and event_properties:path::string = '/dashboard')" in sql
    assert "mart_analytics.amplitude_events" in sql


def test_build_path_weekly_sql_escapes_single_quotes():
    # An apostrophe in a declared event name must not break out of the literal.
    legs = [sa.Leg("Wizard's View", "/x", None)]
    assert "'Wizard''s View'" in eh.build_path_weekly_sql(legs)


def test_build_path_weekly_sql_is_empty_for_no_path_legs():
    assert eh.build_path_weekly_sql([sa.Leg("Viewed", None, None)]) == ""


def test_path_rows_key_into_the_series_under_the_leg_key():
    rows = [{"event_type": "Viewed", "page_path": "/dashboard",
             "week_start": MONDAY - timedelta(days=7), "n": 500}]
    keyed = eh.key_path_rows(rows)
    assert keyed[0]["event_type"] == "Viewed[path=/dashboard]"


# --- latch ranking (DATA-2421 Part B) -----------------------------------------


def test_latched_record_outranks_the_counter_blind_spot_canary():
    record = {"status": "active", "elevated": True, "anomaly": None, "divergence": None,
              "call_site_count": 5, "okr": "win_active_candidates_30d", "latched": True}
    assert eh.rank_record(record) == 0


def test_unlatched_records_rank_exactly_as_before():
    # Guard against the latch field changing behaviour for everything else.
    record = {"status": "dormant", "elevated": False, "anomaly": None, "divergence": None,
              "call_site_count": None, "okr": None, "latched": False}
    assert eh.rank_record(record) == 8


def test_rank_label_covers_the_latched_rank():
    assert "latched" in eh._RANK_LABEL[0].lower() or "okr" in eh._RANK_LABEL[0].lower()


# --- run_monitor: anchors + latches wired end to end (DATA-2421 Part B) -------

_TRACKER = "Campaign Plan - Campaign Tracker Viewed"
_METRIC = "win_active_candidates_30d"
_PATH_KEY = "Viewed[path=/dashboard]"
_CODE_COLS = [
    "event_type", "retired_date", "instrumented_pr", "call_site_count",
    "call_site_retired_date",
]


class _DF:
    """Minimal stand-in for the pandas frame databricks_oauth.run_query returns."""

    def __init__(self, rows):
        self._rows = rows

    def to_dict(self, _orient):
        return list(self._rows)


def _fake_query(catalog_rows, weekly_rows, path_rows=()):
    def run(sql):
        if "amplitude_event_catalog" in sql:
            return _DF(catalog_rows)
        if "event_properties:path" in sql:
            return _DF(path_rows)
        return _DF(weekly_rows)

    return run


def _weeks_before(event_type, counts, page_path=None):
    """Weekly rows for the complete weeks immediately before MONDAY, oldest first."""
    rows = []
    for offset, n in enumerate(reversed(counts), start=1):
        row = {"event_type": event_type, "week_start": MONDAY - timedelta(days=7 * offset),
               "n": n}
        if page_path is not None:
            row["page_path"] = page_path
        rows.append(row)
    return rows


def _monitor_env(tmp_path, code_rows, latches=None, watchlist="events: []\n",
                 prior_flagged=None):
    csv_path = tmp_path / "provenance.csv"
    csv_path.write_text(
        "\n".join([",".join(_CODE_COLS)]
                  + [",".join(str(r.get(c, "")) for c in _CODE_COLS) for r in code_rows])
        + "\n"
    )
    wl_path = tmp_path / "watchlist.yaml"
    wl_path.write_text(watchlist)
    state_path = tmp_path / "state.json"
    if latches is not None:
        state_path.write_text(
            json.dumps({"latches": latches, "flagged": prior_flagged or {}}))
    return csv_path, wl_path, state_path


def _latch(metric=_METRIC, reference=1000.0, latched=True):
    return {"metric": metric, "since": "2026-05-18", "reference": reference,
            "consecutive": 4, "latched": latched}


def test_run_monitor_latched_event_reaches_flagged_after_its_anomaly_cleared(tmp_path):
    # The era-2 failure exactly: four flat broken weeks make the broken level the
    # baseline, detect_anomaly goes quiet, and the record drops out of `flagged` — the
    # only list digest_triage and the Slack quiet gate read.
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    weekly = _weeks_before(_TRACKER, [2, 2, 2, 2, 2])
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={_TRACKER: _latch()}, prior_flagged={"Something Else": "dormant"},
    )
    anchors = {_METRIC: [sa.Leg(_TRACKER, None, None)]}

    result, changes = eh.run_monitor(
        _fake_query(catalog, weekly), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path, anchors=anchors)

    record = next(r for r in result["records"] if r["event_type"] == _TRACKER)
    assert record["anomaly"] is None  # the baseline absorbed the break
    flagged = [r for r in result["flagged"] if r["event_type"] == _TRACKER]
    assert len(flagged) == 1
    # The existing record is promoted, not shadowed by a stand-in: a stand-in would lose
    # the record's own evidence and leave `records` disagreeing with `flagged`.
    assert flagged[0] is record
    assert flagged[0]["status"] == "active"
    assert flagged[0]["rank"] == 0
    assert flagged[0]["latched"] is True
    assert flagged[0]["okr"] == _METRIC
    # The diff runs after the marking, so the break reads as news rather than as a row
    # that was never there.
    assert _TRACKER in changes["new"]

    # Without the latch this same data flags nothing at all — that is the bug.
    unlatched, _ = eh.run_monitor(
        _fake_query(catalog, weekly), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=tmp_path / "absent.json", anchors=anchors)
    assert all(r["event_type"] != _TRACKER for r in unlatched["flagged"])


def _run_with_latched_path_leg(tmp_path):
    catalog = [
        _cat("Viewed", "amplitude_autotrack", "", cnt30=4_460_000),
        _cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8),
    ]
    weekly = _weeks_before("Viewed", [100, 100, 100, 100, 100])
    path_rows = _weeks_before("Viewed", [3, 3], page_path="/dashboard")
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path,
        [{"event_type": _TRACKER, "call_site_count": 3},
         # Never observed -> rank 7, so the flagged list is non-trivially ordered.
         {"event_type": "Ghost Event", "call_site_count": 1}],
        latches={_PATH_KEY: _latch(reference=500.0)},
    )
    anchors = {_METRIC: [sa.Leg("Viewed", "/dashboard", None)]}
    return eh.run_monitor(
        _fake_query(catalog, weekly, path_rows), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path, anchors=anchors)


def test_run_monitor_synthesizes_a_flagged_row_for_a_latched_path_leg(tmp_path):
    # reconcile builds records from the catalog, and 'Viewed[path=/dashboard]' is not a
    # catalog event, so promoting an existing record cannot work for a path leg.
    result, _changes = _run_with_latched_path_leg(tmp_path)

    # Rank 0 sorts to the top: appending without re-sorting would bury it under the
    # lower-severity rows already in the list.
    assert result["flagged"][0]["event_type"] == _PATH_KEY
    synthetic = result["flagged"][0]
    assert synthetic["rank"] == 0
    assert synthetic["okr"] == _METRIC
    assert synthetic["status"] == eh.LATCHED_STATUS
    assert synthetic["event_count_30d"] == 6  # the leg's own rows, not the catalog's

    real = next(r for r in result["records"] if r["event_type"] == _TRACKER)
    assert set(synthetic) == set(real) | {"latched"}


def test_run_monitor_keeps_the_synthesized_row_out_of_the_catalog_counts(tmp_path):
    result, _changes = _run_with_latched_path_leg(tmp_path)

    assert all(r["event_type"] != _PATH_KEY for r in result["records"])
    assert result["total_events"] == 3  # the two catalog events plus Ghost Event
    assert eh.LATCHED_STATUS not in result["status_counts"]


def test_a_latched_path_leg_reaches_the_slack_triage_as_red(tmp_path):
    # The whole point of R2: the markdown log is not the surface people read.
    import digest_triage as dt

    result, changes = _run_with_latched_path_leg(tmp_path)
    items = dt.build_items(result, changes)
    item = next(i for i in items if i["event_type"] == _PATH_KEY)
    assert dt.rules_tier(item) == "red"


def test_run_monitor_passes_the_whole_warehouse_series_to_the_latch(tmp_path, monkeypatch):
    # update_latches tells "this leg went silent" from "the warehouse skipped a week" by
    # looking at events other than the watched leg. A filtered mapping would revert the
    # fix with no other test failing.
    import okr_latch as ol

    seen = {}
    monkeypatch.setattr(
        ol, "update_latches",
        lambda prior, series, watched, today: seen.update(series=series) or {})
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8),
               _cat("Unrelated Event", "win_other", "Other.", cnt30=99)]
    weekly = _weeks_before(_TRACKER, [2, 2]) + _weeks_before("Unrelated Event", [99, 99])
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})

    result, _ = eh.run_monitor(
        _fake_query(catalog, weekly), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})

    assert "Unrelated Event" in seen["series"]
    # And the declared metric reaches reconcile even with nothing latched.
    record = next(r for r in result["records"] if r["event_type"] == _TRACKER)
    assert record["okr"] == _METRIC


def test_run_monitor_marks_okr_only_from_the_declaration(tmp_path):
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8),
               _cat("Unrelated", "win_dashboard", "x", cnt30=3)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={},
        watchlist=f'events:\n  - {{event: "{_TRACKER}"}}\n  - {{event: "Unrelated"}}\n',
    )
    result, _ = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})
    by = {r["event_type"]: r for r in result["records"]}
    assert by[_TRACKER]["okr"] == _METRIC
    assert by["Unrelated"]["okr"] is None
    assert "okr_tag_problems" not in result
    assert result["okr_markers_unavailable"] is False


def test_run_monitor_reports_anchor_problems_from_the_live_read(tmp_path, monkeypatch):
    monkeypatch.setattr(sa, "load_anchors", lambda: ({}, ["token missing"]))
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})

    result, _ = eh.run_monitor(_fake_query(catalog, []), today=TODAY, csv_path=csv_path,
                               watchlist_path=wl_path, state_path=state_path)

    assert result["anchor_problems"] == ["token missing"]
    assert result["latches"] == {}


def test_degraded_anchor_read_says_okr_markers_are_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(sa, "load_anchors", lambda: ({}, ["token missing"]))
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})
    result, changes = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path)
    assert result["okr_markers_unavailable"] is True
    digest = eh.render_digest_section(result, changes)
    assert "OKR markers are unavailable this run" in digest


def test_a_partial_sem_read_marks_okr_markers_unavailable(tmp_path, monkeypatch):
    # One sem file failed, the rest read fine. The metrics in the failed file go
    # unmarked, so a red OKR item there would quietly render yellow.
    monkeypatch.setattr(sa, "load_anchors", lambda: (
        {_METRIC: [sa.Leg(_TRACKER, None, None)]}, ["could not read users_serve.yml"]))
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})

    result, _ = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path)

    assert result["okr_markers_unavailable"] is True
    record = next(r for r in result["records"] if r["event_type"] == _TRACKER)
    assert record["okr"] == _METRIC


# --- latch state file ---------------------------------------------------------


def test_load_prior_latches_tolerates_corrupt_json(tmp_path):
    p = tmp_path / "s.json"
    p.write_text("{not json")
    assert eh.load_prior_latches(p) == {}


def test_load_prior_latches_missing_key_returns_empty(tmp_path):
    p = tmp_path / "s.json"
    p.write_text(json.dumps({"flagged": {}}))
    assert eh.load_prior_latches(p) == {}


def test_load_prior_latches_reads_valid_records(tmp_path):
    p = tmp_path / "s.json"
    p.write_text(json.dumps({"latches": {_PATH_KEY: _latch()}}))
    assert eh.load_prior_latches(p)[_PATH_KEY]["metric"] == _METRIC


def test_main_persists_the_latches_for_the_next_run(monkeypatch, tmp_path):
    latches = {_PATH_KEY: _latch()}

    def _stub(*_a, **_k):
        result = {"run_date": "2026-09-21", "current_week_basis": "x", "flagged": [],
                  "status_counts": {}, "total_events": 0, "latches": latches}
        return result, {"new": [], "escalated": [], "resolved": [], "still_open": []}

    monkeypatch.setattr(eh, "run_monitor", _stub)
    state = tmp_path / "s.json"
    # A logging run, because --no-log now suppresses the state write too, and this test
    # is about the state write. --log is redirected so it never touches the real log.
    assert eh.main(["--log", str(tmp_path / "log.md"), "--today", "2026-09-21",
                    "--state", str(state)]) == 0
    assert json.loads(state.read_text())["latches"] == latches


# --- digest rendering of the latch + degradation lines ------------------------


def _render_result(**kw):
    base = {"run_date": date(2026, 9, 21), "current_week_basis": "complete weeks before x",
            "total_events": 1, "status_counts": {"active": 1}, "flagged": []}
    base.update(kw)
    return base


_NO_CHANGES = {"new": [], "escalated": [], "resolved": [], "still_open": []}


def test_digest_renders_the_latched_anchor_table():
    out = eh.render_digest_section(
        _render_result(latches={_PATH_KEY: _latch(reference=1234.5)}), _NO_CHANGES)
    assert "### OKR anchors dormant (latched)" in out
    assert f"| {_PATH_KEY} | {_METRIC} | 2026-05-18 | 1234.5 /wk |" in out
    assert "There is no dismiss path." in out


def test_digest_omits_the_table_for_a_tracked_but_unlatched_leg():
    out = eh.render_digest_section(
        _render_result(latches={_PATH_KEY: _latch(latched=False)}), _NO_CHANGES)
    assert "### OKR anchors dormant (latched)" not in out


def test_digest_shouts_when_the_anchor_read_failed():
    out = eh.render_digest_section(
        _render_result(anchor_problems=["token missing"]), _NO_CHANGES)
    assert "> **OKR dormancy checks degraded.** token missing" in out
    assert "### Flagged (by cause)" in out  # the rest of the digest still renders


def test_anchor_problem_posts_to_slack_as_red_with_its_text_intact(monkeypatch):
    # run_triage overwrites headline/action on every item it is handed, so this item has
    # to be added after the judge or the problem text is replaced by a fallback.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = _render_result(anchor_problems=["GP_DATA_PLATFORM_READ_TOKEN is not set"],
                            proposals=[])

    triage = eh.build_slack_triage(result, _NO_CHANGES, state_path=None, gap=None)

    assert triage is not None  # a quiet run must not swallow the degradation
    item = triage["items"][0]
    assert item["tier"] == "red"
    assert item["headline"] == "GP_DATA_PLATFORM_READ_TOKEN is not set"
    assert "GP_DATA_PLATFORM_READ_TOKEN" in item["action"]


def test_run_monitor_does_not_duplicate_a_latched_record_already_flagged(tmp_path):
    # A latched leg that ALSO still has a live anomaly is already in `flagged`; appending
    # unconditionally would list it twice in the digest and in the Slack triage.
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=1)]
    weekly = _weeks_before(_TRACKER, [1000, 1000, 1000, 1000, 1])
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={_TRACKER: _latch()},
    )

    result, _ = eh.run_monitor(
        _fake_query(catalog, weekly), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})

    rows = [r for r in result["flagged"] if r["event_type"] == _TRACKER]
    assert len(rows) == 1
    assert rows[0]["anomaly"] is not None  # it was flagged on its own merits too
    assert rows[0]["rank"] == 0  # and the latch still outranks that


def test_digest_survives_a_latch_record_a_hand_edit_broke():
    # okr_latch deliberately carries a partial record rather than crashing; the renderer
    # must not undo that by raising on the missing field.
    out = eh.render_digest_section(
        _render_result(latches={_PATH_KEY: {"latched": True, "since": "2026-05-18"}}),
        _NO_CHANGES)
    assert f"| {_PATH_KEY} | ? | 2026-05-18 | ? /wk |" in out


def test_a_degraded_anchor_read_holds_the_latches_instead_of_wiping_them(tmp_path,
                                                                         monkeypatch):
    # The state file is the only place a sticky reference lives, and it cannot be
    # re-derived once the break has aged into the baseline. Losing it on a token blip
    # would rebuild this ticket's bug inside the degradation path.
    monkeypatch.setattr(sa, "load_anchors", lambda: ({}, ["token missing"]))
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={_TRACKER: _latch()})

    result, _ = eh.run_monitor(_fake_query(catalog, []), today=TODAY, csv_path=csv_path,
                               watchlist_path=wl_path, state_path=state_path)

    assert result["latches"][_TRACKER]["reference"] == 1000.0
    assert any(r["event_type"] == _TRACKER and r["rank"] == 0
               for r in result["flagged"])


def test_a_leg_the_semantic_layer_stopped_declaring_clears_its_latch(tmp_path):
    # The successful-read case is the one that IS a de-declaration, and it must still
    # clear — that is the only way a latch goes away besides recovery.
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={_TRACKER: _latch()})

    result, _ = eh.run_monitor(_fake_query(catalog, []), today=TODAY, csv_path=csv_path,
                               watchlist_path=wl_path, state_path=state_path,
                               anchors={_METRIC: [sa.Leg("Some Other Event", None, None)]})

    assert result["latches"] == {}
    assert all(r["event_type"] != _TRACKER for r in result["flagged"])


def test_rank_zero_canary_and_latch_render_different_labels():
    # Rank 0 is the line a reader acts on first and it covers two unrelated findings.
    # Labelling a tooling alert as a dormant OKR metric costs the digest its credibility
    # exactly where it can least afford to.
    # The canary carries an okr: tag too, so the label has to key off `latched` rather
    # than "is this event OKR-anchored" — an anchored event can hit the canary while its
    # instrument is perfectly healthy.
    canary = _flag("Canary", 0, "active", call_site_count=0, event_count_30d=50,
                   okr=_METRIC)
    latched = _flag("Latched", 0, "active", latched=True, okr=_METRIC, event_count_30d=50)
    out = eh.render_digest_section(_render_result(flagged=[canary, latched]), _NO_CHANGES)

    canary_row = next(ln for ln in out.splitlines() if "| Canary |" in ln)
    latched_row = next(ln for ln in out.splitlines() if "| Latched |" in ln)
    assert "counter blind spot" in canary_row
    assert "OKR anchor dormant" not in canary_row
    assert "OKR anchor dormant (latched)" in latched_row
    assert "counter blind spot" not in latched_row


# --- degradation branches (DATA-2421 Part B, review round 2) ------------------


def _recording_query(catalog_rows, weekly_rows, path_rows=(), seen_sql=None):
    inner = _fake_query(catalog_rows, weekly_rows, path_rows)

    def run(sql):
        if seen_sql is not None:
            seen_sql.append(sql)
        return inner(sql)

    return run


def test_run_monitor_never_watches_a_historical_leg(tmp_path, monkeypatch):
    # Historical legs are kept so old numbers stay right, but they are not expected to
    # fire. Watching one alarms forever; querying its path slice is wasted warehouse work.
    import okr_latch as ol

    seen_sql, seen = [], {}
    monkeypatch.setattr(ol, "update_latches",
                        lambda prior, series, watched, today: seen.update(watched=watched) or {})
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})

    eh.run_monitor(
        _recording_query(catalog, [], seen_sql=seen_sql), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg("Old Name", "/old", "historical"),
                           sa.Leg(_TRACKER, None, None)]})

    assert "Old Name[path=/old]" not in seen["watched"]  # watched_by_key filter
    assert _TRACKER in seen["watched"]
    assert not any("/old" in sql for sql in seen_sql)  # watched_legs filter


_POLLS_BEHAVIOR = (
    "behaviors:\n"
    "  - id: polls_viewed\n"
    "    product: win\n"
    f"    metric: {_METRIC}\n"
    "    surfaces:\n"
    '      - {path: a.tsx, label: polls, instrumented_by: "Viewed", page_path: "/polls"}\n'
)


def _run_with_an_undeclared_path_surface(tmp_path, seen_sql=None):
    catalog = [_cat("Viewed", "amplitude_autotrack", "", cnt30=4_460_000)]
    weekly = _weeks_before("Viewed", [100, 100, 100, 100, 100])
    path_rows = (_weeks_before("Viewed", [3, 3], page_path="/dashboard")
                 + _weeks_before("Viewed", [5, 5], page_path="/polls"))
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": "Viewed", "call_site_count": 1}], latches={},
        watchlist=_POLLS_BEHAVIOR)
    return eh.run_monitor(
        _recording_query(catalog, weekly, path_rows, seen_sql=seen_sql), today=TODAY,
        csv_path=csv_path, watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg("Viewed", "/dashboard", None)]})


def test_run_monitor_queries_weekly_rows_for_registry_path_surfaces(tmp_path):
    # Case 3 IS the undeclared surface, so querying only declared legs leaves the check
    # permanently blind to the thing it exists to catch: no rows, never live, no finding.
    seen_sql = []
    result, _ = _run_with_an_undeclared_path_surface(tmp_path, seen_sql=seen_sql)

    assert any("/polls" in sql for sql in seen_sql)
    [f] = [x for x in result["anchor_alignment"]
           if x["kind"] == "live_instrument_not_declared"]
    assert f["event_key"] == "Viewed[path=/polls]" and f["case"] == 3


def test_run_monitor_does_not_latch_an_undeclared_path_surface(tmp_path):
    # Widening the query must not widen what the latch owns: only a declared leg is a
    # governed instrument, and latching an undeclared one would post red for a slice no
    # metric depends on.
    result, _ = _run_with_an_undeclared_path_surface(tmp_path)

    assert "Viewed[path=/polls]" not in result["latches"]


def test_a_metric_whose_every_leg_is_historical_is_reported(tmp_path):
    # An anchored metric with no live leg left is this ticket's disease in its purest
    # form, and today it produces no signal at all.
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={"Old Name": _latch(metric="win_dead_metric")})

    result, _ = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={"win_dead_metric": [sa.Leg("Old Name", None, "historical")]})

    assert any("win_dead_metric" in p for p in result["anchor_problems"])
    # Marking a leg historical is a governed declaration change, which is one of the two
    # sanctioned ways a latch clears. Reporting the condition must not suppress that.
    assert result["latches"] == {}


def test_a_partial_anchor_read_does_not_resurrect_a_recovered_latch(tmp_path, monkeypatch):
    # The hold exists for legs the degraded read can no longer see. A leg it CAN still
    # see, which update_latches just cleared on recovery, must stay cleared or it posts
    # red forever.
    monkeypatch.setattr(
        sa, "load_anchors",
        lambda: ({_METRIC: [sa.Leg(_TRACKER, None, None)]}, ["one sem file unreadable"]))
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=5000)]
    weekly = _weeks_before(_TRACKER, [1000, 1000, 1000, 1000, 1000])
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={_TRACKER: _latch(reference=1000.0)})

    result, _ = eh.run_monitor(_fake_query(catalog, weekly), today=TODAY,
                               csv_path=csv_path, watchlist_path=wl_path,
                               state_path=state_path)

    assert _TRACKER not in result["latches"]
    assert all(r["rank"] != 0 for r in result["flagged"])


def test_the_degraded_hold_skips_records_a_hand_edit_broke(tmp_path, monkeypatch):
    # okr_latch tolerates a corrupt state record rather than killing the digest; the
    # hold must not undo that by carrying one into the marking loop.
    monkeypatch.setattr(sa, "load_anchors", lambda: ({}, ["token missing"]))
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={"No Metric Leg": {"latched": True, "since": "2026-05-18"},
                 "Junk Leg": "not a mapping",
                 _PATH_KEY: _latch()})

    result, _ = eh.run_monitor(_fake_query(catalog, []), today=TODAY, csv_path=csv_path,
                               watchlist_path=wl_path, state_path=state_path)

    assert "No Metric Leg" not in result["latches"]
    assert "Junk Leg" not in result["latches"]
    assert result["latches"][_PATH_KEY]["metric"] == _METRIC  # the good one still held


def test_run_monitor_creates_a_latch_from_the_series_with_no_prior_state(tmp_path):
    # The real production path: no seeded latch, the break inferred from the weekly rows
    # plus the zero-fill. Every other latch test starts from a state file, so this is the
    # only one that exercises series -> latch at the wiring level.
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=0),
               _cat("Unrelated Event", "win_other", "Other.", cnt30=99)]
    # The leg simply stops producing rows for the last two weeks; those zeros are
    # inferred by the zero-fill, and only the unrelated event proves the warehouse
    # loaded them at all.
    weekly = ([{"event_type": _TRACKER, "week_start": MONDAY - timedelta(days=7 * o),
                "n": 1000} for o in (5, 4, 3)]
              + _weeks_before("Unrelated Event", [99, 99, 99, 99, 99]))
    csv_path, wl_path, _unused = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}])

    result, _ = eh.run_monitor(
        _fake_query(catalog, weekly), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=tmp_path / "no-prior.json",
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})

    latch = result["latches"][_TRACKER]
    assert latch["latched"] is True
    assert latch["consecutive"] == 2  # never on the first broken week
    assert latch["since"] == (MONDAY - timedelta(days=14)).isoformat()
    assert latch["reference"] == 750.0  # captured from the series, not from a state file
    assert any(r["event_type"] == _TRACKER and r["rank"] == 0 for r in result["flagged"])


def test_multiple_anchor_problems_reach_slack_in_order(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = _render_result(anchor_problems=["first problem", "second problem"],
                            proposals=[])

    triage = eh.build_slack_triage(result, _NO_CHANGES, state_path=None, gap=None)

    assert [i["headline"] for i in triage["items"][:2]] == ["first problem",
                                                            "second problem"]


def test_unavailable_okr_markers_reach_slack_as_red(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = _render_result(okr_markers_unavailable=True, anchor_problems=["token missing"],
                            proposals=[])
    triage = eh.build_slack_triage(result, _NO_CHANGES, state_path=None, gap=None)
    assert triage is not None
    item = next(i for i in triage["items"] if "OKR markers are unavailable" in i["headline"])
    assert item["tier"] == "red"


def test_main_state_write_survives_a_date_inside_a_latch_record(monkeypatch, tmp_path):
    # The state file is the only place the sticky reference lives, and its latch records
    # are authored by another module. A bare json.dumps would fail the whole run.
    latches = {_PATH_KEY: {**_latch(), "first_seen": date(2026, 5, 18)}}

    def _stub(*_a, **_k):
        result = {"run_date": "2026-09-21", "current_week_basis": "x", "flagged": [],
                  "status_counts": {}, "total_events": 0, "latches": latches}
        return result, {"new": [], "escalated": [], "resolved": [], "still_open": []}

    monkeypatch.setattr(eh, "run_monitor", _stub)
    state = tmp_path / "s.json"
    # Not --no-log: that now suppresses the state write this test is about.
    assert eh.main(["--log", str(tmp_path / "log.md"), "--today", "2026-09-21",
                    "--state", str(state)]) == 0
    assert json.loads(state.read_text())["latches"][_PATH_KEY]["first_seen"] == "2026-05-18"


def test_a_malformed_sem_file_still_produces_a_digest(tmp_path, monkeypatch):
    # End to end for the worst degradation: a bad leg merged in gp-data-platform used to
    # raise out of load_anchors, through run_monitor and main, failing the CI step — no
    # digest, no Slack, no state write-back. The whole point is that the digest survives
    # AND says what broke.
    bad = ("metrics:\n  - name: m\n    config:\n      meta:\n"
           "        anchored_on:\n          - path: /x\n")
    monkeypatch.setenv(sa.TOKEN_ENV, "fake-token")
    monkeypatch.setattr(sa, "_fetch", lambda path, token: bad)
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})

    result, changes = eh.run_monitor(_fake_query(catalog, []), today=TODAY,
                                     csv_path=csv_path, watchlist_path=wl_path,
                                     state_path=state_path)
    out = eh.render_digest_section(result, changes)

    assert any("malformed" in p for p in result["anchor_problems"])
    assert "> **OKR dormancy checks degraded.**" in out
    assert "### Flagged (by cause)" in out  # the rest of the digest still renders
    assert result["total_events"] == 1  # and the other two axes still reconciled


# --- warehouse freshness (DATA-2421 Part B) -----------------------------------
#
# okr_latch caps its zero-fill at the most recent week ANY event has rows for, which
# is what stops a warehouse outage false-latching every leg at once. Nothing reported
# when that cap froze, so the monitor ran happily against stale data and said nothing.


def _stale_warehouse_env(tmp_path, oldest_offset):
    """Weekly rows that stop `oldest_offset` weeks before MONDAY, i.e. a lagging load."""
    weekly = [{"event_type": _TRACKER, "week_start": MONDAY - timedelta(days=7 * o),
               "n": 500}
              for o in range(oldest_offset, oldest_offset + 5)]
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=2000)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})
    return eh.run_monitor(
        _fake_query(catalog, weekly), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})


def test_a_warehouse_behind_the_last_complete_week_is_reported(tmp_path):
    # Rows stop two weeks back, so the latch's zero-fill silently freezes there and no
    # leg is judged for the most recent complete week at all.
    result, _ = _stale_warehouse_env(tmp_path, oldest_offset=2)

    problems = result["anchor_problems"]
    assert len(problems) == 1, problems
    # Both weeks named: "behind" is useless without saying behind what, and by how much.
    assert "2026-06-08" in problems[0]  # last week any event has rows for
    assert "2026-06-15" in problems[0]  # the most recent complete week
    assert result["warehouse_lag_problems"] == problems
    # And it reaches the digest, not just the result dict.
    assert problems[0] in eh.render_digest_section(result, _NO_CHANGES)


def test_a_current_warehouse_reports_no_staleness(tmp_path):
    # Rows through the most recent complete week: the normal case, and with ~581 events
    # in a 63-day window it is the case on every run the pipeline is healthy.
    result, _ = _stale_warehouse_env(tmp_path, oldest_offset=1)

    assert result["anchor_problems"] == []
    assert result["warehouse_lag_problems"] == []


def test_an_empty_weekly_result_does_not_claim_staleness(tmp_path):
    # No rows at all is a different failure with no week to name, and every event reads
    # as dormant on its own. Claiming a specific lag here would be a fabricated date.
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}], latches={})

    result, _ = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})

    assert result["warehouse_lag_problems"] == []


def test_a_stale_warehouse_does_not_hold_the_latch_clear_open(tmp_path):
    # It goes in anchor_problems, never read_problems: read_problems holds every latch
    # open against a failed anchor read, and a lagging warehouse is not an anchor read
    # failure. A leg that genuinely recovered must still be allowed to clear.
    weekly = [{"event_type": _TRACKER, "week_start": MONDAY - timedelta(days=7 * o),
               "n": 1000} for o in range(2, 7)]
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=5000)]
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={_TRACKER: _latch(reference=1000.0)})

    result, _ = eh.run_monitor(
        _fake_query(catalog, weekly), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})

    assert result["warehouse_lag_problems"] != []
    assert _TRACKER not in result["latches"], (
        "the staleness report must not behave like a failed anchor read and hold a "
        "recovered latch open"
    )


def test_the_staleness_item_posts_yellow_and_never_flips_red(monkeypatch):
    # Yellow, unlike the other anchor-problem items: a lagging load is an operational
    # condition the digest should say out loud, not a broken guard. It must also appear
    # exactly once, even though it is carried in anchor_problems, whose other entries
    # splice as red.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    lag = ("The warehouse has loaded no event rows past the week of 2026-06-08, but the "
           "most recent complete week is 2026-06-15.")
    result = _render_result(
        anchor_problems=[lag], warehouse_lag_problems=[lag], proposals=[],
        flagged=[{"event_type": "A", "status": "dormant", "rank": 8, "okr": None,
                  "on_watchlist": False, "elevated": False, "anomaly": None,
                  "event_count_30d": 0, "last_seen_date": None, "instrumented_pr": None,
                  "divergence": None, "gpmeta": None}])
    changes = {"new": ["A"], "escalated": [], "resolved": [], "still_open": []}

    triage = eh.build_slack_triage(result, changes, state_path=None, gap=None)

    matching = [i for i in triage["items"] if i["headline"] == lag]
    assert len(matching) == 1, "carried in anchor_problems, but not ALSO spliced as red"
    assert matching[0]["tier"] == "yellow"
    assert not any(i.get("tier") == "red" for i in triage["items"]), (
        "a lagging warehouse must not flip red_open and force a weekly post"
    )


def test_a_stale_warehouse_alone_does_not_force_a_slack_post(monkeypatch):
    # Mirrors the gate the other anchor-problem items pass through. Yellow means it rides
    # along with a post that was going to happen; it does not manufacture one on an
    # otherwise quiet week.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    lag = "The warehouse has loaded no event rows past the week of 2026-06-08."
    result = _render_result(anchor_problems=[lag], warehouse_lag_problems=[lag],
                            proposals=[])

    assert eh.build_slack_triage(result, _NO_CHANGES, state_path=None, gap=None) is None


def test_a_real_anchor_problem_still_posts_red_alongside_a_stale_warehouse(monkeypatch):
    # The exclusion is an exact-text membership check against the lag list. That is a
    # real text match, but no genuine read-failure string can equal a lag string, so a
    # genuine read failure in the same run still keeps its red tier.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    lag = "The warehouse has loaded no event rows past the week of 2026-06-08."
    result = _render_result(anchor_problems=["GP_DATA_PLATFORM_READ_TOKEN is not set", lag],
                            warehouse_lag_problems=[lag], proposals=[])

    triage = eh.build_slack_triage(result, _NO_CHANGES, state_path=None, gap=None)

    assert triage is not None
    tiers = {i["headline"]: i["tier"] for i in triage["items"]}
    assert tiers["GP_DATA_PLATFORM_READ_TOKEN is not set"] == "red"
    assert tiers[lag] == "yellow"


# --- registry vs semantic layer wired into the run ----------------------------


def test_run_monitor_reports_alignment_findings(tmp_path):
    dead = "Dashboard - Candidate Dashboard Viewed"
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8),
               _cat(dead, "win_dashboard", "Old.", cnt30=0)]
    watchlist = (
        "behaviors:\n"
        "  - id: weekly_active_candidates\n"
        "    metric: win_active_candidates_30d\n"
        "    product: win\n"
        "    surfaces:\n"
        f'      - {{path: a.tsx, label: dashboard_visit, instrumented_by: "{dead}"}}\n'
        f'      - {{path: b.tsx, label: tracker, instrumented_by: "{_TRACKER}"}}\n'
    )
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3},
                   {"event_type": dead, "retired_date": "2026-07-13"}],
        latches={}, watchlist=watchlist)
    result, changes = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg("Viewed", "/dashboard", None),
                           sa.Leg(dead, None, "historical"), sa.Leg(_TRACKER, None, None)]})
    kinds = {f["kind"] for f in result["anchor_alignment"]}
    assert "surface_on_historical_leg" in kinds
    assert "declared_leg_unmonitored" in kinds  # Viewed[path=/dashboard] is named nowhere
    digest = eh.render_digest_section(result, changes)
    assert "### Registry vs semantic layer" in digest


def test_a_partial_sem_read_does_not_accuse_a_correct_metric_pointer(tmp_path, monkeypatch):
    # One sem file read, the other failed. A behavior pointing into the file that failed
    # still has a correct pointer, and the read failure is already reported red in
    # anchor_problems, so case 1 must not tell a reviewer to go and fix the pointer.
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8)]
    watchlist = (
        "behaviors:\n"
        "  - id: weekly_active_candidates\n"
        "    metric: win_active_candidates_30d\n"
        "    product: win\n"
        "    surfaces:\n"
        f'      - {{path: b.tsx, label: tracker, instrumented_by: "{_TRACKER}"}}\n'
        "  - id: serve_behavior\n"
        "    metric: serve_missing_metric\n"
        "    product: serve\n"
        "    surfaces:\n"
        f'      - {{path: c.tsx, label: tracker_serve, instrumented_by: "{_TRACKER}"}}\n'
    )
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3}],
        latches={}, watchlist=watchlist)
    monkeypatch.setattr(sa, "load_anchors", lambda: (
        {_METRIC: [sa.Leg(_TRACKER, None, None)]}, ["the serve sem file could not be read"]))

    result, _ = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path)

    assert not [f for f in result["anchor_alignment"] if f["kind"] == "metric_undeclared"]
    assert result["anchor_problems"]


def test_run_monitor_passes_queue_c_dismissals_to_align(tmp_path):
    catalog = [_cat(_TRACKER, "win_dashboard", "Tracker.", cnt30=8),
               _cat("Campaign Plan - Tracker Opened", "win_dashboard", "New.", cnt30=8)]
    watchlist = (
        "behaviors:\n"
        "  - id: b\n"
        "    metric: win_active_candidates_30d\n"
        "    product: win\n"
        "    surfaces:\n"
        f'      - {{path: a.tsx, label: old, instrumented_by: "{_TRACKER}"}}\n'
        '      - {path: b.tsx, label: new, instrumented_by: "Campaign Plan - Tracker Opened"}\n'
        "dismissed:\n"
        '  - {event: "Campaign Plan - Tracker Opened", reason: "not a view", date: "2026-09-23", metric: win_active_candidates_30d}\n'
    )
    csv_path, wl_path, state_path = _monitor_env(
        tmp_path, [{"event_type": _TRACKER, "call_site_count": 3, "retired_date": "2026-09-01"},
                   {"event_type": "Campaign Plan - Tracker Opened", "call_site_count": 1}],
        latches={}, watchlist=watchlist)
    result, _ = eh.run_monitor(
        _fake_query(catalog, []), today=TODAY, csv_path=csv_path,
        watchlist_path=wl_path, state_path=state_path,
        anchors={_METRIC: [sa.Leg(_TRACKER, None, None)]})
    assert not [f for f in result["anchor_alignment"] if f["case"] == 2]


def test_alignment_case_2_reaches_slack_as_yellow_and_case_1_does_not(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = _render_result(
        proposals=[],
        anchor_alignment=[
            {"case": 1, "kind": "metric_undeclared", "behavior_id": "b", "metric": "m",
             "surface_label": None, "event_key": "", "suggested": "", "evidence": {},
             "headline": "case one"},
            {"case": 2, "kind": "declared_leg_dead_with_live_successor", "behavior_id": "b",
             "metric": "m", "surface_label": "s", "event_key": "Old", "suggested": "New",
             "evidence": {}, "headline": "case two"},
        ],
        flagged=[{"event_type": "A", "status": "dormant", "rank": 8, "okr": None,
                  "on_watchlist": False, "elevated": False, "anomaly": None,
                  "event_count_30d": 0, "last_seen_date": None, "instrumented_pr": None,
                  "divergence": None, "gpmeta": None}])
    changes = {"new": ["A"], "escalated": [], "resolved": [], "still_open": []}
    triage = eh.build_slack_triage(result, changes, state_path=None, gap=None)
    heads = [i["headline"] for i in triage["items"]]
    assert "case two" in heads and "case one" not in heads
    assert next(i for i in triage["items"] if i["headline"] == "case two")["tier"] == "yellow"


def test_alignment_alone_does_not_force_a_post(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = _render_result(proposals=[], anchor_alignment=[
        {"case": 2, "kind": "k", "behavior_id": "b", "metric": "m", "surface_label": None,
         "event_key": "Old", "suggested": "New", "evidence": {}, "headline": "case two"}])
    assert eh.build_slack_triage(result, _NO_CHANGES, state_path=None, gap=None) is None
