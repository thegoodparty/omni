"""Latch tests (DATA-2421).

The headline case is era 2: the monitor caught the break, then the rolling
four-week baseline absorbed it and the alarm switched itself off.
"""

from __future__ import annotations

from datetime import date, timedelta

import okr_latch as ol
from analytics_event_health import RETIREMENT_FLOOR_PCT

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
    # reference = mean(700, 700, 10, 10) = 355, threshold = 35.5. Trailing broken run is
    # the last three weeks (10, 10, 8, each < 35.5); week index 1 (700) is not broken and
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
    # R14 / Critical 1. Reviewer's repro, re-derived for LATCH_BREAK_PCT: a single week at
    # 150 against a reference of 682.5 is still a 78% drop -- clearly not a real recovery --
    # but it crosses the OLD single-threshold drop condition (`not _is_broken`, since 150
    # sits above the 10% break floor of 68.25). RECOVERY_PCT's much higher bar (341.25)
    # means this "band" week (neither broken by the tight floor nor recovered) must not drop
    # the record or destroy the sticky reference, and `latched` must stay sticky even though
    # this week alone does not extend the trailing broken run.
    #
    # This fixture used to use 40, the band value for the old 5% floor. At 10% that is a
    # BROKEN week: the test would still pass while exercising the broken path instead of
    # the band, which is precisely the kind of silently-decorative fixture this branch has
    # been bitten by. The band is now (68.25, 341.25).
    key = "Dashboard - Campaign Plan Viewed"
    prior = {key: {
        "metric": "win_active_candidates_30d", "since": "2026-08-03",
        "reference": 682.5, "consecutive": 4, "latched": True,
    }}
    series = {key: _weeks([700, 680, 660, 690, 20, 18, 22, 150])}
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
    # Only 4 real weeks are ever returned for this leg; it goes silent after that. A second,
    # unrelated event with rows through week index 6 proves the warehouse loaded those later
    # weeks for someone -- this leg's absence in them is real silence, not a warehouse gap
    # (see Critical/item 3's own dedicated tests for that distinction in isolation).
    raw_series = {
        key: _weeks([700, 680, 660, 690]),
        "Some Other Event": _weeks([50, 50, 50, 50, 50, 50, 50]),
    }

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
    # Minor 5. `_is_broken` uses a strict `<`. Changing it to `<=` passes every other test
    # in this file, because none of them puts a value exactly on the threshold.
    # reference=100 makes the break floor exactly 10 under LATCH_BREAK_PCT; current=10 sits
    # exactly on it and must NOT count as broken. The old fixture's 5 was the boundary of
    # the 5% shared floor; at 10% it is well inside the broken region and would stop
    # testing the comparison operator at all.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([100, 100, 100, 100, 10])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=35))
    assert key not in state, (
        "current exactly at LATCH_BREAK_PCT * reference is not broken (strict <)"
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


def test_prior_missing_since_degrades_instead_of_indexerror():
    # Fix round 3, item 1. Reviewer's exact repro: a prior with `reference`/`consecutive`/
    # `latched` but no `since` at all, reaching the band path (this week, 150, is neither
    # broken by the tight floor nor recovered against 682.5). Before this fix, the since
    # fallback `weeks[len(weeks) - consecutive]` indexed `weeks[len(weeks)]` when
    # `consecutive == 0` and raised IndexError -- every record this module ever writes
    # itself sets `since`, so a record missing it is exactly the kind of untrustworthy
    # persisted state Minor 7 already degrades rather than crashes on.
    key = "Dashboard - Campaign Plan Viewed"
    prior = {key: {"metric": "win_active_candidates_30d", "reference": 682.5,
                    "consecutive": 4, "latched": True}}  # no "since"
    series = {key: _weeks([700, 680, 660, 690, 20, 18, 22, 150])}
    state = ol.update_latches(prior, series, WATCHED, today=W0 + timedelta(days=56))
    # Must not raise. Degrading the whole record to "no prior" means this specific band
    # week (not itself broken by the tight floor) produces no record rather than crashing.
    assert key not in state


def test_densify_truncating_to_empty_degrades_instead_of_indexerror():
    # Fix round 3, item 2. `_densify` can return `[]` when the leg's first observed week is
    # later than the window it's allowed to fill (here, `today` predates the leg's own
    # first row). The line right after densify used to do `weeks[-1][1]` unconditionally,
    # which raises IndexError on an empty list. Not reachable once B4 derives `today` from
    # the same clock as the query window, but this module must degrade, not crash, on it.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 680, 660, 690, 20])}
    # today lands on the leg's own first observed week, so the "most recent complete week"
    # is a week before any data exists at all -- the forward-fill loop never runs once.
    state = ol.update_latches({}, series, WATCHED, today=W0)
    assert key not in state  # must not raise, and there is nothing to latch on


def test_warehouse_gap_does_not_latch_a_healthy_leg():
    # Fix round 3, item 3, direction A. R15's own promise ("never create [a latch] from
    # absence, which would fire on a warehouse gap") broke the moment densify started
    # zero-filling purely off `today`: a leg that is the ONLY event in `series` and simply
    # has no rows for the last two weeks looks identical to a leg that went silent. Without
    # any other event proving the warehouse loaded those weeks, they must not be
    # fabricated as zeros -- reviewer's exact repro: 700/week for six weeks, "latched: True,
    # reference: 525" if this regresses.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 700, 700, 700, 700, 700])}  # nothing else in `series` at all
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=56))
    assert key not in state, (
        "a gap where no event has rows must not be fabricated as a break for a healthy leg"
    )


def test_leg_specific_silence_still_latches_when_other_events_have_rows():
    # Fix round 3, item 3, direction B. The mirror of the test above: when some OTHER event
    # in `series` has rows through the same later weeks, the warehouse clearly loaded them,
    # so this leg's own absence in them is real, leg-specific silence and must still latch.
    key = "Dashboard - Campaign Plan Viewed"
    series = {
        key: _weeks([700, 700, 700, 700, 700, 700]),  # silent for weeks 6 and 7
        "Some Other Event": _weeks([50, 50, 50, 50, 50, 50, 50, 50]),  # has rows through week 7
    }
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=56))
    assert key in state, (
        "a gap where other events DO have rows must still read as this leg going silent"
    )
    assert state[key]["latched"] is True


def test_densify_never_fills_backward_past_the_first_observed_week():
    # Fix round 3, item 4. Reviewer's exact finding: starting the fill cursor four weeks
    # before the first observed week still passes every other test in this file, because
    # every other fixture has at least five observed weeks, so fabricated leading zeros
    # never reach `_reference`'s window. With only two real observed weeks and no backward
    # fill, there are only ever 2 weeks total -- below MIN_BASELINE_WEEKS -- so no record can
    # be judged at all. A backward fill of 4 weeks would fabricate 6 total weeks (4 fake
    # zeros + these 2 real ones), which is enough for `_reference` to compute a depressed
    # reference from fabricated history and wrongly judge the real, second week as broken.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([700, 0])}  # only 2 real observed weeks
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=14))
    assert key not in state, (
        "two real weeks is too little history to judge -- backward-filled fabricated "
        "history must not manufacture enough weeks to produce a (wrong) verdict"
    )


def test_a_ninety_percent_drop_is_broken_though_the_shared_retirement_floor_misses_it():
    # Why LATCH_BREAK_PCT exists. The 2026-07-31 incident ran at 676.5/week and collapsed
    # to 32. RETIREMENT_FLOOR_PCT puts the break line at 33.8, so the entire incident sat
    # 1.8 fires/week from invisible, and a drop only slightly shallower than the real one
    # -- 34/week, still a 95% drop -- is past the shared floor entirely. The latch-specific
    # floor puts the line at 67.65 and sees it.
    key = "Dashboard - Campaign Plan Viewed"
    series = {key: _weeks([676, 677, 676, 677, 34])}
    state = ol.update_latches({}, series, WATCHED, today=W0 + timedelta(days=35))
    assert state[key]["reference"] == 676.5
    assert state[key]["consecutive"] == 1, (
        "the break week must be seen -- one week short of latching, not unseen"
    )
    assert 34 > RETIREMENT_FLOOR_PCT * 676.5, (
        "fixture guard: this count must be INVISIBLE to the shared floor, or the test "
        "passes without the latch-specific one"
    )


def test_the_latch_floor_is_its_own_and_leaves_the_shared_one_alone():
    # RETIREMENT_FLOOR_PCT is what detect_anomaly runs over all ~581 events with, and what
    # the retirement classification keys on. Tightening the latch must not move it -- that
    # would rewrite the digest for every event on the list, which is not what this ticket
    # is for.
    assert RETIREMENT_FLOOR_PCT == 0.05
    assert ol.LATCH_BREAK_PCT > RETIREMENT_FLOOR_PCT
    assert ol.RECOVERY_PCT > ol.LATCH_BREAK_PCT, (
        "recovery must stay a strictly higher bar than break, or there is no band"
    )
