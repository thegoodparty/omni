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
