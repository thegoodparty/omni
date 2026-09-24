"""Compare omni's behavior registry against the semantic layer's declared legs.

Two directions, one loop. The definition flows down: a metric's events are whatever
gp-data-platform's anchored_on says, and nothing here overrides that. Evidence flows up:
omni is where a product change shows first, and when a declared leg dies while a behavior
already names its successor, the only correct output is a recommendation upstream.

Each finding carries a case that says who is behind:
  1  omni is behind the declaration        -> edit monitored_events.yaml
  2  the declaration is behind the product -> draft an anchored_on change for gp-data-platform
  3  the two disagree on scope             -> a human decides, then case 1 or 2

A reviewer's dismissal, recorded in `dismissed:` with the metric name, silences the
case 2 or case 3 finding it names; case 1 has no dismiss.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import yaml

from behavior_registry import metric_list, surface_key

_LIVE = frozenset({"active"})
_DEAD = frozenset({"retired", "dormant"})
LIVE_WINDOW_DAYS = 30


def _live(key: str, records_by_type, series, today) -> bool:
    """A bare event is live when health called it active. A path leg has no catalog
    record, so its own weekly rows are the only honest source."""
    if "[path=" in key:
        cutoff = today - timedelta(days=LIVE_WINDOW_DAYS)
        return any(n > 0 for week_start, n in series.get(key, ()) if week_start >= cutoff)
    return (records_by_type.get(key) or {}).get("status") in _LIVE


def _dead_leg_evidence(leg, records_by_type, code, latches, series, today) -> dict | None:
    # A path leg is judged from its own weekly rows: the site-wide event's record reads
    # active whenever any other page still fires it, which would hide a dead slice.
    retired = (code.get(leg.event) or {}).get("retired_date") or None
    latched = bool((latches.get(leg.key) or {}).get("latched"))
    if "[path=" in leg.key:
        # A path slice is judged from its own rows, not the bare event's catalog record:
        # a retired_date on the bare event does not make a still-firing slice dead. Only
        # a latch, or rows that are missing or gone quiet, can.
        rows = series.get(leg.key, ())
        if not latched and (
                not rows or _live(leg.key, records_by_type, series, today)):
            return None
        return {
            "retired_date": retired,
            "latched": latched,
            "status": None,
            "last_seen_date": None,
            "call_site_count": None,
        }
    rec = records_by_type.get(leg.event) or {}
    if not retired and not latched and rec.get("status") not in _DEAD:
        return None
    return {
        "retired_date": retired,
        "latched": latched,
        "status": rec.get("status"),
        "last_seen_date": rec.get("last_seen_date"),
        "call_site_count": rec.get("call_site_count"),
    }


def _finding(case, kind, *, metric, headline, behavior_id=None, surface_label=None,
             event_key="", suggested="", evidence=None) -> dict:
    return {
        "case": case, "kind": kind, "behavior_id": behavior_id, "metric": metric,
        "surface_label": surface_label, "event_key": event_key, "suggested": suggested,
        "evidence": evidence or {}, "headline": headline,
    }


def load_dismissals(path: Path) -> list[dict]:
    """Queue C dismissals: the `dismissed:` rows that name a metric. Queue B rows have no
    metric and are the proposal queue's business."""
    path = Path(path)
    if not path.exists():
        return []
    doc = yaml.safe_load(path.read_text()) or {}
    return [
        row for row in (doc.get("dismissed") or [])
        if isinstance(row, Mapping) and row.get("event") and row.get("metric")
    ]


def align(
    behaviors: Sequence[Mapping[str, Any]],
    anchors: Mapping[str, Sequence[Any]],
    *,
    records_by_type: Mapping[str, Mapping[str, Any]],
    series: Mapping[str, Sequence[tuple[date, int]]],
    code: Mapping[str, Mapping[str, Any]],
    watchlist_events: Iterable[str],
    latches: Mapping[str, Mapping[str, Any]],
    today: date,
    dismissed: Iterable[Mapping[str, Any]] = (),
    partial_read: bool = False,
) -> list[dict]:
    """``partial_read`` says some sem file failed to read, so ``anchors`` is incomplete.
    "No sem file declares this metric" is then unknowable, and case 1 would accuse a
    correct pointer, so that one check is skipped. The read failure itself is already
    reported red through anchor_problems."""
    if not anchors:
        # No declaration was read. Comparing against nothing would report every
        # behavior; run_monitor already reports the read failure in red.
        return []
    dismissed_keys = {(str(r["metric"]), str(r["event"])) for r in dismissed}
    monitored = set(watchlist_events)
    for b in behaviors:
        for s in b.get("surfaces") or []:
            # The leg key alone. A path surface watches one slice, so adding the bare
            # event too would let a '/dashboard' surface silence an unwatched declared
            # 'Viewed' or 'Viewed[path=/home]'.
            key = surface_key(s)
            if key:
                monitored.add(key)

    findings: list[dict] = []
    # A leg is unmonitored once per metric, however many behaviors point at that metric.
    seen_unmonitored: set[tuple[str, str]] = set()
    for b in behaviors:
        bid = b.get("id")
        for metric in metric_list(b):
            legs = anchors.get(metric)
            if legs is None:
                if not partial_read:
                    findings.append(_finding(
                        1, "metric_undeclared", metric=metric, behavior_id=bid,
                        headline=(f"{bid} points at metric '{metric}', which no sem file "
                                  "declares. Fix the pointer, or the metric is not "
                                  "governed yet.")))
                continue
            live_legs = [leg for leg in legs if leg.watched]
            if not live_legs:
                continue  # anchor_problems already reports an all-historical metric
            live_keys = {leg.key for leg in live_legs}
            hist_keys = {leg.key for leg in legs if not leg.watched}
            surfaces = [s for s in (b.get("surfaces") or []) if surface_key(s)]
            live_undeclared = [
                s for s in surfaces
                if surface_key(s) not in live_keys and surface_key(s) not in hist_keys
                and _live(surface_key(s), records_by_type, series, today)
            ]
            consumed: set[str] = set()

            for leg in live_legs:
                evidence = _dead_leg_evidence(
                    leg, records_by_type, code, latches, series, today)
                if evidence is None or not live_undeclared:
                    continue
                # Pop, so a second dead leg pairs with the next unmatched surface rather
                # than telling the reader to replace both legs with the same event. A
                # dismissal rules out that one candidate, not the rest of the queue.
                successor = None
                while live_undeclared:
                    candidate = live_undeclared.pop(0)
                    consumed.add(surface_key(candidate))
                    if (metric, surface_key(candidate)) not in dismissed_keys:
                        successor = candidate
                        break
                if successor is None:
                    continue
                findings.append(_finding(
                    2, "declared_leg_dead_with_live_successor", metric=metric, behavior_id=bid,
                    surface_label=successor.get("label"), event_key=leg.key,
                    suggested=surface_key(successor), evidence=evidence,
                    headline=(f"'{metric}' still declares {leg.key}, which is no longer "
                              f"firing, while {bid} now fires {surface_key(successor)} on "
                              "the same behavior. The declaration is behind the product.")))

            for s in surfaces:
                key = surface_key(s)
                if key in hist_keys:
                    suggested = ", ".join(sorted(live_keys))
                    findings.append(_finding(
                        1, "surface_on_historical_leg", metric=metric, behavior_id=bid,
                        surface_label=s.get("label"), event_key=key, suggested=suggested,
                        headline=(f"{bid}.{s.get('label')} names {key}, which '{metric}' "
                                  f"marks historical. Point it at {suggested}.")))
                elif (s in live_undeclared and key not in consumed
                      and (metric, key) not in dismissed_keys):
                    findings.append(_finding(
                        3, "live_instrument_not_declared", metric=metric, behavior_id=bid,
                        surface_label=s.get("label"), event_key=key,
                        headline=(f"{bid}.{s.get('label')} fires {key}, which '{metric}' "
                                  "does not declare. Either the metric should count it, or "
                                  "the behavior overclaims.")))

            for leg in live_legs:
                if leg.key not in monitored and leg.event not in monitored:
                    if (metric, leg.key) in seen_unmonitored:
                        continue
                    seen_unmonitored.add((metric, leg.key))
                    findings.append(_finding(
                        1, "declared_leg_unmonitored", metric=metric, behavior_id=bid,
                        event_key=leg.key, suggested=leg.key,
                        headline=(f"'{metric}' declares {leg.key}, but no behavior surface "
                                  "or watchlist row names it. Add it to the behavior that "
                                  "answers this metric.")))

    findings.sort(key=lambda f: (f["case"], f["metric"], f["behavior_id"] or "",
                                 f["surface_label"] or ""))
    return findings


_CASE_LABELS = (
    (1, "omni is behind the declaration"),
    (2, "the declaration is behind the product"),
    (3, "the two disagree on scope"),
)


def render_section(findings: Sequence[Mapping[str, Any]]) -> list[str]:
    if not findings:
        return []
    lines = ["", "### Registry vs semantic layer", ""]
    for case, label in _CASE_LABELS:
        rows = [f for f in findings if f["case"] == case]
        if not rows:
            continue
        lines.append(f"**Case {case}, {label}**")
        lines.extend(f"- {f['headline']}" for f in rows)
        lines.append("")
    lines.append("Triage: `/triage-instrumentation-gaps`, Queue C.")
    return lines


def slack_items(findings: Sequence[Mapping[str, Any]]) -> list[dict]:
    """Only case 2 reaches Slack: a declaration behind the product is the one shape a
    human outside this loop must hear about. Cases 1 and 3 are registry housekeeping."""
    return [
        {
            "id": "(anchor alignment)",
            "event_type": f["event_key"] or "(anchor alignment)",
            "rank": 5, "okr": f["metric"],
            "rules_tier": "yellow", "tier": "yellow",
            "headline": f["headline"],
            "action": "Run /triage-instrumentation-gaps Queue C to draft the anchored_on change.",
        }
        for f in findings if f["case"] == 2
    ]
