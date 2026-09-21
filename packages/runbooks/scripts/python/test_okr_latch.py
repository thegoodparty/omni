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
    # is exactly the drift the sticky reference exists to prevent. Under RECOVERY_PCT a
    # stored 0.0 makes every count "recovered" (current >= 0.5*0 is always true), so the
    # correct behaviour is now that the record drops -- it does NOT get a chance to survive
    # with a wrong, silently recomputed reference. A regression to `or` instead of `is None`
    # would keep the leg alive with a freshly recomputed ~682.5 reference instead, since
    # 0 (this series' current week) is well short of recovering against that larger number.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 680, 660, 690, 0])}
    prior = {key: {
        "metric": "win_active_candidates_30d", "since": "2026-06-01",
        "reference": 0.0, "consecutive": 1, "latched": False,
    }}
    state = ol.update_latches(prior, series, WATCHED, today=W0 + timedelta(days=35))
    assert key not in state, (
        "stored 0.0 must be respected as a real reference (and drop via degenerate "
        "recovery), not silently recomputed into a nonzero value that keeps the record alive"
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


def test_a_noisy_week_in_the_band_does_not_clear_an_existing_latch():
    # R14 / Critical 1. Reviewer's exact repro: a single week at 40 against a reference of
    # 682.5 is still a 94% drop -- clearly not a real recovery -- but it crosses the OLD
    # single-threshold drop condition (`not _is_broken`, since 40 sits just above the 5%
    # break floor of 34.125). RECOVERY_PCT's much higher bar (341.25) means this "band" week
    # (neither broken by the tight floor nor recovered) must not drop the record or destroy
    # the sticky reference, and `latched` must stay sticky even though this week alone does
    # not extend the trailing broken run.
    key = "Dashboard - Campaign Plan Viewed"
    prior = {key: {
        "metric": "win_active_candidates_30d", "since": "2026-08-03",
        "reference": 682.5, "consecutive": 4, "latched": True,
    }}
    series = {key: _weeks([700, 680, 660, 690, 20, 18, 22, 40])}
    state = ol.update_latches(prior, series, WATCHED, today=W0 + timedelta(days=56))
    assert key in state, (
        "a band week (neither broken nor recovered) must not drop the record"
    )
    assert state[key]["reference"] == 682.5, (
        "the sticky reference must survive a band week untouched"
    )
    assert state[key]["latched"] is True, (
        "latched is sticky once True; a band week must not clear it"
    )
    assert state[key]["consecutive"] == 0, (
        "the trailing broken run does reset on a non-broken week -- only `latched` is sticky"
    )


def test_total_silence_latches_and_an_existing_latch_survives_it():
    # R15 / Critical 2. A leg that stops firing produces no rows for the missing weeks, not
    # zero-count rows. Without zero-filling, the series' last entry stays the last *healthy*
    # count the leg ever had, so it never reads as broken -- or, worse, an already-latched
    # record would read that stale healthy count as a fresh recovery and clear itself.
    key = "Dashboard - Campaign Plan Viewed"
    # Only 4 real weeks are ever returned; the leg goes silent after that.
    raw_series = {key: _weeks([700, 680, 660, 690])}

    # First call: two silent weeks have passed beyond the last real data point. today is
    # chosen so densify fills weeks 5 and 6 in with zeros.
    state1 = ol.update_latches({}, raw_series, WATCHED, today=W0 + timedelta(days=42))
    assert "Dashboard - Campaign Plan Viewed" in state1, (
        "total silence must latch -- it must not be invisible for lack of rows"
    )
    assert state1[key]["latched"] is True, (
        "two zero-filled silent weeks is a break, not a stale healthy tail"
    )
    assert state1[key]["consecutive"] == 2

    # Second call: three more silent weeks pass with no new rows at all. The already-latched
    # record must not be misread as recovering back to the last real (healthy) count -- it
    # must stay latched against the same sticky reference.
    state2 = ol.update_latches(state1, raw_series, WATCHED, today=W0 + timedelta(days=49))
    assert key in state2, "an already-latched record must survive continued silence"
    assert state2[key]["latched"] is True
    assert state2[key]["reference"] == state1[key]["reference"], (
        "reference must stay sticky through the silence, not reread as a healthy recovery"
    )


def test_no_data_run_holds_open_an_existing_latch_unchanged():
    # Important 3. The reviewer's wrong implementation replaced this whole branch with a
    # bare `continue`, and every existing test still passed -- that version drops a latched
    # break on a single warehouse gap, with no recovery and without the leg leaving
    # `watched`, which is a direct violation of the "clears only two ways" invariant.
    key = "Dashboard - Campaign Plan Viewed"
    prior = {key: {
        "metric": "win_active_candidates_30d", "since": "2026-08-03",
        "reference": 682.5, "consecutive": 4, "latched": True,
    }}
    # The key is present in `watched` but this run's series has no rows for it at all.
    state = ol.update_latches(prior, {}, WATCHED, today=W0)
    assert state.get(key) == prior[key], (
        "a warehouse gap (no rows this run) must hold the existing record unchanged"
    )


def test_no_data_run_still_refreshes_a_stale_metric_name():
    # Minor 6. The no-data branch must copy `metric` from `watched`, not from the stored
    # record -- otherwise a metric rename in the sem layer never reaches a leg that happens
    # to hit a warehouse gap on the run right after the rename.
    key = "Dashboard - Campaign Plan Viewed"
    prior = {key: {
        "metric": "an_old_renamed_metric", "since": "2026-08-03",
        "reference": 682.5, "consecutive": 4, "latched": True,
    }}
    state = ol.update_latches(prior, {}, WATCHED, today=W0)
    assert state[key]["metric"] == WATCHED[key], (
        "metric must be refreshed from watched even on a no-data run"
    )
    assert state[key]["reference"] == 682.5, "everything else about the record is untouched"


def test_consecutive_counts_the_trailing_run_not_every_broken_week():
    # Important 4. The reviewer's wrong implementation summed every broken week in the whole
    # series (`sum(1 for _, n in weeks if _is_broken(n, reference))`), and all existing tests
    # still passed -- every fixture happened to put its broken weeks only in the trailing
    # run. This series separates them: two broken weeks (20, 18) followed by three healthy
    # weeks, then one more broken week (20). The trailing run is 1; counting every broken
    # week in the series gives 3, which would wrongly latch on the first week of what is
    # actually a brand-new, still-single-week break.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 20, 18, 700, 700, 700, 20])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=49))
    assert state[key]["consecutive"] == 1, (
        "consecutive must be the trailing broken run, not a count of every broken week"
    )
    assert state[key]["latched"] is False, (
        "one trailing broken week must not latch -- LATCH_AFTER_WEEKS is 2"
    )


def test_is_broken_boundary_is_strict_not_inclusive():
    # Minor 5. `_is_broken` uses a strict `<`, matching detect_anomaly. Changing it to `<=`
    # passes every other test in this file, because none of them puts a value exactly on
    # the threshold. reference=100 makes the break floor exactly 5; current=5 sits exactly
    # on it and must NOT count as broken.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([100, 100, 100, 100, 5])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=35))
    assert key not in state, (
        "current exactly at RETIREMENT_FLOOR_PCT * reference is not broken (strict <)"
    )


def test_malformed_prior_state_degrades_instead_of_raising():
    # Minor 7. A persisted record that isn't even a mapping (a corrupted state file could
    # easily produce this) must not raise -- this module exists to keep an alarm from going
    # quiet, and it must not take the whole digest down on bad state instead.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 680, 660, 690, 20])}

    # Case A: the whole persisted value for this leg is a bare string, not a dict.
    prior_a = {key: "corrupted"}
    state_a = ol.update_latches(prior_a, series, WATCHED, today=W0 + timedelta(days=35))
    assert state_a[key]["consecutive"] == 1
    assert state_a[key]["latched"] is False

    # Case B: the record is a dict, but `reference` round-tripped as a non-numeric string.
    prior_b = {key: {
        "metric": "m", "since": "2026-06-01", "reference": "not-a-number",
        "consecutive": 1, "latched": False,
    }}
    state_b = ol.update_latches(prior_b, series, WATCHED, today=W0 + timedelta(days=35))
    assert state_b[key]["consecutive"] == 1
    assert state_b[key]["latched"] is False
