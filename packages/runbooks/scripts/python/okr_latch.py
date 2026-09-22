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

from datetime import date, timedelta
from typing import Any, Mapping, Sequence

from analytics_event_health import ABSOLUTE_FLOOR, MIN_BASELINE_WEEKS

# A single bad week is usually ingestion lag or a holiday, not a break. Two consecutive
# weeks costs one week of delay against a failure mode that ran undetected for a month.
LATCH_AFTER_WEEKS = 2

# Deliberately NOT analytics_event_health.RETIREMENT_FLOOR_PCT (0.05), which this module
# used to reuse. Two reasons, and the first is why the fix is scoped here rather than
# applied at the source: that floor is shared with detect_anomaly, which runs over all ~581
# catalog events, and with the retirement classification, so moving it would rewrite the
# digest for every event on the list. The second is that 5% is simply too lenient for the
# failure this module exists to catch. Run the 2026-07-31 incident's own numbers: a
# 676.5 fires/week instrument fell to 32 in the break week, which puts the shared floor at
# 33.8 — a 94.5% drop that cleared detection by 1.8 fires a week, with anything marginally
# shallower walking straight past it. At 0.10 a week is broken when it is below a tenth of
# the reference, so a 90% drop or worse is caught, and only the handful of OKR-anchored
# legs are affected.
LATCH_BREAK_PCT = 0.10

# RECOVERY is a different question than BROKEN, and the review that found this (R14,
# DATA-2421) is why it gets its own bar instead of reusing the break floor. The break floor
# is calibrated to catch a drop as early as possible; using that same line to decide when to
# let go means a single noisy week just above it (still a ~90% drop) clears the latch and
# destroys the sticky reference — the exact era-2 failure this module exists to prevent,
# reachable from one bad week instead of four. RECOVERY_PCT sits well above the break floor
# so ordinary noise in a broken instrument's counts can't cross it, and well below a real
# recovery so it doesn't hold one hostage. The value is a judgement call, not one the tests
# pin down: every value roughly between 0.22 and 0.95 satisfies all of them.
RECOVERY_PCT = 0.5

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
    """Held against a fixed reference rather than detect_anomaly's rolling one, and at the
    latch's own tighter floor rather than the shared retirement one — see LATCH_BREAK_PCT.
    Below ABSOLUTE_FLOOR a percentage is meaningless, so require zero."""
    if reference < ABSOLUTE_FLOOR:
        return current == 0
    return current < LATCH_BREAK_PCT * reference


def _is_recovered(current: int, reference: float) -> bool:
    """The higher, deliberately separate bar that clears a latch — see RECOVERY_PCT."""
    return current >= RECOVERY_PCT * reference


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


def _warehouse_last_loaded(series: Mapping[str, Sequence[tuple[date, int]]]) -> date | None:
    """The most recent week for which *any* event in the warehouse has rows.

    "This leg has no rows for week N" is ambiguous on its own: it means either the leg went
    silent (a real break) or the warehouse simply hadn't loaded week N yet for anyone (an
    ingestion gap). The two are distinguishable only by looking outside the one leg being
    judged — if some other event in `series` has rows for week N, the warehouse did load
    that week, so a watched leg with no rows for it is silence, not a gap. If nothing in the
    whole `series` mapping has rows for week N, there is no evidence the warehouse loaded it
    at all, so it must not be fabricated as a zero (R15 follow-up, DATA-2421 review).
    """
    last: date | None = None
    for weeks in series.values():
        for week_start, _ in weeks:
            if last is None or week_start > last:
                last = week_start
    return last


def _densify(
    weeks: Sequence[tuple[date, int]], today: date, warehouse_last_loaded: date | None
) -> list[tuple[date, int]]:
    """Zero-fill from a leg's first observed week through the most recent *loaded* week.

    A leg that stops firing entirely — a route rename, a removed `trackEvent` call — stops
    producing rows for the missing weeks rather than producing zero-count rows. Without this,
    the series' last entry stays the last *healthy* week the leg ever fired: it reads as
    never-broken, or worse, as a fresh recovery that clears an existing latch (R15,
    DATA-2421). This finally gives `today` a job: it defines where "most recent complete
    week" is when the leg's own data has nothing to say about it — capped by
    `warehouse_last_loaded` so a week nothing in the warehouse loaded is never fabricated as
    a zero for a leg that was otherwise perfectly healthy.

    Never fills backward from the leg's first observed week — that would fabricate a broken
    pre-history for an instrument that simply hadn't been observed yet.
    """
    if not weeks:
        return list(weeks)
    step = timedelta(days=7)
    current_week_start = today - timedelta(days=today.weekday())
    last_complete = current_week_start - step
    if warehouse_last_loaded is not None and warehouse_last_loaded < last_complete:
        last_complete = warehouse_last_loaded
    observed = dict(weeks)
    filled: list[tuple[date, int]] = []
    cursor = weeks[0][0]
    while cursor <= last_complete:
        filled.append((cursor, observed.get(cursor, 0)))
        cursor += step
    return filled


def _sanitize_record(raw: Any) -> dict[str, Any]:
    """Degrade a malformed persisted record to "no prior" instead of raising.

    This module exists to keep an alarm from going quiet; it must not take the whole
    digest down over a corrupt state file. A record that isn't even a mapping, or whose
    `reference` doesn't round-trip to a number, can't be trusted for anything it stores —
    treating it as absent re-derives a fresh reference from the series instead of crashing.

    Every branch that ever writes a record also sets `since`, so a non-empty record
    missing it isn't a state this module produces itself — it's as untrustworthy as a
    reference that doesn't round-trip. Left unguarded, the band-week `since` fallback
    tries to index a trailing broken run of length 0 and raises IndexError.
    """
    if not isinstance(raw, Mapping):
        return {}
    record = dict(raw)
    reference = record.get("reference")
    if reference is not None:
        try:
            record["reference"] = float(reference)
        except (TypeError, ValueError):
            return {}
    if record and record.get("since") is None:
        return {}
    return record


def update_latches(
    prior: Mapping[str, Mapping[str, Any]],
    series: Mapping[str, Sequence[tuple[date, int]]],
    watched: Mapping[str, str],
    today: date,
) -> dict[str, dict[str, Any]]:
    """Advance latch state by one run.

    ``series`` must be the WHOLE warehouse's weekly series, not just the watched legs.
    A leg with no rows for a week is either silence (a real break) or the warehouse not
    having loaded that week yet, and the only way to tell them apart is whether some
    *other* event has rows for it — see ``_warehouse_last_loaded``. Passing a filtered
    mapping makes every leg look silent the moment ingestion lags, and nothing in this
    module can detect that it happened.

    ``watched`` maps leg key to the metric it anchors; keys absent from it are dropped,
    which is how a re-declared anchor clears a latch.
    """
    state: dict[str, dict[str, Any]] = {}
    warehouse_last_loaded = _warehouse_last_loaded(series)
    for key, metric in watched.items():
        raw_weeks = list(series.get(key) or [])
        record = _sanitize_record(prior.get(key))

        if not raw_weeks:
            # This leg has no rows at all — not even one, ever. That is a real, total
            # absence, distinct from a warehouse-wide gap (see `_warehouse_last_loaded`):
            # there is nothing here to distinguish "leg went silent" from "leg was never
            # observed," so hold any existing latch and never create one from nothing.
            # Still refresh `metric` — the sem layer can rename a metric without the leg
            # key changing.
            if record:
                state[key] = {**record, "metric": metric}
            continue

        weeks = _densify(raw_weeks, today, warehouse_last_loaded)
        if not weeks:
            # The leg's first observed week is later than the window `_densify` allows
            # (e.g. `today` predates it). Not currently reachable — B4 derives `today` and
            # the query window from the same clock — but this module must degrade rather
            # than index into an empty list.
            if record:
                state[key] = {**record, "metric": metric}
            continue
        current = weeks[-1][1]

        # Explicit None check: a stored reference of 0.0 is falsy but still a real,
        # captured reference. Treating it as "not set" would recompute it every run
        # from a rolling window, which is exactly the drift the latch exists to prevent.
        stored_reference = record.get("reference")
        reference = stored_reference if stored_reference is not None else _reference(weeks)
        if reference is None:
            continue  # too little history to judge

        if not record:
            # First observation of this leg: only start tracking it once it is actually
            # broken. Recovery doesn't apply yet — there is nothing latched to recover from.
            if not _is_broken(current, reference):
                continue
            consecutive = _consecutive_broken(weeks, reference)
            state[key] = {
                "metric": metric,
                "since": weeks[len(weeks) - consecutive][0].isoformat(),
                "reference": round(float(reference), 1),
                "consecutive": consecutive,
                "latched": consecutive >= LATCH_AFTER_WEEKS,
            }
            continue

        # A tracked leg clears only on recovery — a distinct, higher bar than the break
        # floor (RECOVERY_PCT). Anything short of recovery, including a week that is
        # neither broken nor recovered, keeps the record and its sticky reference intact.
        if _is_recovered(current, reference):
            continue

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
            # Sticky: once latched, stays latched until recovery or de-declaration — even
            # through a band week that drops the trailing broken run below LATCH_AFTER_WEEKS.
            "latched": bool(record.get("latched")) or consecutive >= LATCH_AFTER_WEEKS,
        }
    return state
