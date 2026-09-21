"""Latch tests (DATA-2421).

The headline case is era 2: the monitor caught the break, then the rolling
four-week baseline absorbed it and the alarm switched itself off.
"""

from __future__ import annotations

from datetime import date, timedelta

import okr_latch as ol

WATCHED = {"Dashboard - Campaign Plan Viewed": "win_active_candidates_30d"}
W0 = date(2026, 7, 6)


def _weeks(counts):
    return [(W0 + timedelta(days=7 * i), n) for i, n in enumerate(counts)]


def test_a_single_bad_week_does_not_latch():
    # Pipeline lag and holiday weeks look exactly like this. One week is not a break.
    series = {"Dashboard - Campaign Plan Viewed": _weeks([700, 680, 660, 690, 20])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=35))
    assert state["Dashboard - Campaign Plan Viewed"]["latched"] is False
    assert state["Dashboard - Campaign Plan Viewed"]["consecutive"] == 1


def test_two_consecutive_bad_weeks_latch():
    series = {"Dashboard - Campaign Plan Viewed": _weeks([700, 680, 660, 690, 20, 18])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=42))
    assert state["Dashboard - Campaign Plan Viewed"]["latched"] is True


def test_era_2_stays_latched_after_the_baseline_absorbs_the_break():
    # THE regression. Eight weeks at the broken level makes broken the new baseline, so
    # detect_anomaly goes quiet. The latch must not.
    series = {"Dashboard - Campaign Plan Viewed": _weeks(
        [700, 680, 660, 690, 20, 18, 22, 19, 21, 20, 23, 18]
    )}
    state = {}
    for week in range(5, 13):
        state = ol.update_latches(
            state,
            {k: v[:week] for k, v in series.items()},
            WATCHED,
            today=W0 + timedelta(days=7 * week),
        )
    assert state["Dashboard - Campaign Plan Viewed"]["latched"] is True
    assert state["Dashboard - Campaign Plan Viewed"]["reference"] > 600


def test_recovery_clears_the_latch():
    series = {"Dashboard - Campaign Plan Viewed": _weeks([700, 680, 660, 690, 20, 18, 650])}
    state = {"Dashboard - Campaign Plan Viewed": {
        "metric": "win_active_candidates_30d", "since": "2026-08-03",
        "reference": 682.5, "consecutive": 2, "latched": True,
    }}
    state = ol.update_latches(state, series, WATCHED, today=W0 + timedelta(days=49))
    assert "Dashboard - Campaign Plan Viewed" not in state


def test_a_leg_no_longer_declared_drops_out_of_the_latch_state():
    # Re-declaring the anchor is the governed way to clear a latch.
    prior = {"Old - Event": {"metric": "m", "since": "2026-08-03",
                             "reference": 100.0, "consecutive": 3, "latched": True}}
    state = ol.update_latches(prior, {}, WATCHED, today=W0)
    assert "Old - Event" not in state


def test_time_alone_does_not_clear_a_latch():
    series = {"Dashboard - Campaign Plan Viewed": _weeks([700, 680, 660, 690, 20, 18])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=42))
    for extra in range(1, 20):
        state = ol.update_latches(state, series, WATCHED, today=W0 + timedelta(days=42 + 7 * extra))
    assert state["Dashboard - Campaign Plan Viewed"]["latched"] is True


def test_a_stored_zero_reference_is_not_silently_recomputed():
    # A reference of 0.0 is falsy but real. `record.get("reference") or _reference(...)`
    # would treat it as "not set" and recompute from the rolling window every run, which
    # is exactly the drift the sticky reference exists to prevent. If this regresses, the
    # assertion below fails because the output reference jumps from 0.0 to ~682.5.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 680, 660, 690, 0])}
    prior = {key: {
        "metric": "win_active_candidates_30d", "since": "2026-06-01",
        "reference": 0.0, "consecutive": 1, "latched": False,
    }}
    state = ol.update_latches(prior, series, WATCHED, today=W0 + timedelta(days=35))
    assert state[key]["reference"] == 0.0, (
        "stored reference of 0.0 must be kept as-is, not recomputed from the series"
    )


def test_an_all_zero_series_never_latches():
    # Without the reference<=0 guard, a series that has always been zero computes a
    # reference of 0.0, reads every future zero week as "broken", and latches forever
    # against a reference that was never a healthy level to begin with. If this
    # regresses, the key below appears in the output instead of being absent.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([0, 0, 0, 0, 0])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=35))
    assert key not in state, "an all-zero series has no healthy reference to latch against"


def test_since_is_the_first_broken_week_of_the_run_not_the_last():
    # The digest renders `since` as "broken since"; the truthful answer is when the run
    # of broken weeks started, not the most recent broken week. If this regresses to
    # weeks[-1] instead of the run's start, the first assertion below fails (it would
    # read the seventh week's date instead of the fifth week's).
    key = "Dashboard - Campaign Plan Viewed"
    # reference = mean(700, 700, 10, 10) = 355, threshold = 17.75. Trailing broken run is
    # the last three weeks (10, 10, 8, each < 17.75); week index 1 (700) is not broken and
    # stops the walk, so the run starts at index 2 (day 14), not index 4 (day 28, the last).
    series = {key: _weeks([700, 700, 10, 10, 8])}
    fresh_state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=35))
    assert fresh_state[key]["since"] == (W0 + timedelta(days=14)).isoformat(), (
        "since must be the first broken week of the trailing run, not the last"
    )

    # Sticky half: once `since` is set, it must not be recomputed on later runs. The
    # stored value here (2026-06-15) is deliberately NOT the date this same series would
    # freshly recompute (2026-07-20, asserted above) — an unconditional recompute would
    # overwrite it with that date instead of preserving it.
    prior = {key: {
        "metric": "win_active_candidates_30d", "since": "2026-06-15",
        "reference": 355.0, "consecutive": 2, "latched": True,
    }}
    sticky_state = ol.update_latches(prior, series, WATCHED, today=W0 + timedelta(days=35))
    assert sticky_state[key]["since"] == "2026-06-15", (
        "an existing since must be preserved, not recomputed from the current run"
    )


def test_consecutive_is_recounted_from_the_series_each_run_not_incremented():
    # The distinguishing case: a prior run counter of 1, but the series itself shows only
    # ONE trailing broken week (the week before the latest broken week was healthy). A
    # series-derived count must reset to 1 and stay unlatched. A hybrid that instead does
    # `prior["consecutive"] + 1` whenever the current week is broken would report 2 and
    # latch here, regardless of whether the week before it actually continued a run.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 680, 660, 690, 700, 20])}
    prior = {key: {
        "metric": "win_active_candidates_30d", "since": "2026-08-10",
        "reference": 682.5, "consecutive": 1, "latched": False,
    }}
    state = ol.update_latches(prior, series, WATCHED, today=W0 + timedelta(days=42))
    assert state[key]["consecutive"] == 1, (
        "consecutive must be recounted from the series' trailing broken run, "
        "not incremented from the prior run's stored count"
    )
    assert state[key]["latched"] is False, (
        "a run-counter increment would wrongly latch here on the second call"
    )
