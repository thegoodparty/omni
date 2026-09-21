"""Latch a break on an OKR-anchored instrument (DATA-2421).

`detect_anomaly` compares the current week against a trailing four-week mean. That is a
good cliff detector and it caught the 2026-07-31 dashboard break the week it happened.
It is a bad *liveness guard*, because after four broken weeks the broken level becomes
the baseline and the alarm switches itself off — which is exactly what happened, and why
a wrong OKR ran quiet for a month.

The latch fixes the second problem without touching the first. It captures the pre-break
level once, then holds the finding open against that fixed reference, so no amount of
elapsed time can make a break look normal.

It clears two ways and only two ways: the signal recovers, or the leg stops being
declared in the semantic layer. There is deliberately no dismiss path — silencing an OKR
break should require a governed change to what the metric is anchored on.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Mapping, Sequence

from analytics_event_health import (
    ABSOLUTE_FLOOR,
    MIN_BASELINE_WEEKS,
    RETIREMENT_FLOOR_PCT,
)

# A single bad week is usually ingestion lag or a holiday, not a break. Two consecutive
# weeks costs one week of delay against a failure mode that ran undetected for a month.
LATCH_AFTER_WEEKS = 2

# KNOWN LIMITATION, accepted 2026-09-21 (DATA-2421 pre-mortem item c).
# The reference is the mean of the four weeks before the current one, so it is only a
# *healthy* reference if the instrument was healthy when this first observed it. An
# instrument already broken at rollout has an already-depressed baseline, reads as
# steady, and never latches. It becomes protected once it has four healthy weeks again.
#
# This was accepted rather than fixed: the query window is 63 days, so a break older
# than nine weeks is invisible to any wider lookback too, and inferring a pre-break level
# from arbitrary history is guesswork. Breaks that predate rollout are found by audit
# (that is how DATA-2343 found these three) and repaired under their own tickets.


def _reference(weeks: Sequence[tuple[date, int]]) -> float | None:
    """Mean of the four complete weeks before the current one: the pre-break level."""
    if len(weeks) < MIN_BASELINE_WEEKS:
        return None
    baseline = [n for _, n in weeks[-MIN_BASELINE_WEEKS:-1]]
    if not baseline:
        return None
    mean = sum(baseline) / len(baseline)
    # Mirrors detect_anomaly's own guard: a zero (or negative, impossible but defensive)
    # reference would latch permanently against nothing, since every future value would
    # read as broken forever with no way to recover.
    return mean if mean > 0 else None


def _is_broken(current: int, reference: float) -> bool:
    """Same thresholds as detect_anomaly, held against a fixed reference rather than a
    rolling one. Below ABSOLUTE_FLOOR a percentage is meaningless, so require zero."""
    if reference < ABSOLUTE_FLOOR:
        return current == 0
    return current < RETIREMENT_FLOOR_PCT * reference


def _consecutive_broken(weeks: Sequence[tuple[date, int]], reference: float) -> int:
    """Trailing run length of broken weeks, counted from the series — not from a prior
    run counter. A run counter counts scheduled-workflow *runs*, which under-counts every
    time a run is skipped; this counts weeks, which is what the constraint actually names."""
    count = 0
    for _, n in reversed(weeks):
        if not _is_broken(n, reference):
            break
        count += 1
    return count


def update_latches(
    prior: Mapping[str, Mapping[str, Any]],
    series: Mapping[str, Sequence[tuple[date, int]]],
    watched: Mapping[str, str],
    today: date,
) -> dict[str, dict[str, Any]]:
    """Advance latch state by one run.

    ``watched`` maps leg key to the metric it anchors; keys absent from it are dropped,
    which is how a re-declared anchor clears a latch.
    """
    state: dict[str, dict[str, Any]] = {}
    for key, metric in watched.items():
        weeks = list(series.get(key) or [])
        record = dict(prior.get(key) or {})
        if not weeks:
            # No data at all this run. Hold any existing latch; never create one from
            # absence, which would fire on a warehouse gap.
            if record:
                state[key] = record
            continue

        current = weeks[-1][1]
        # Explicit None check: a stored reference of 0.0 is falsy but still a real,
        # captured reference. Treating it as "not set" would recompute it every run
        # from a rolling window, which is exactly the drift the latch exists to prevent.
        stored_reference = record.get("reference")
        reference = stored_reference if stored_reference is not None else _reference(weeks)
        if reference is None:
            continue  # too little history to judge

        if not _is_broken(current, reference):
            continue  # recovered, or never broken: drop the record entirely

        consecutive = _consecutive_broken(weeks, reference)
        since = record.get("since")
        if since is None:
            # First time this leg is latching: "since" is the first broken week of the
            # trailing run, not the most recent one — that is the truthful "broken since"
            # the digest renders.
            since = weeks[len(weeks) - consecutive][0].isoformat()

        state[key] = {
            "metric": metric,
            "since": since,
            "reference": round(float(reference), 1),
            "consecutive": consecutive,
            "latched": consecutive >= LATCH_AFTER_WEEKS,
        }
    return state
