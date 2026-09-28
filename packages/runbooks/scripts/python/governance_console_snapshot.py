"""Build the governance console's data file: everything the page renders, in one JSON.

Joins, all in one pass:
  - the health report (gitignored, present in the workspace during the cron run):
    status counts, the flagged set, watchlist proposals, alignment findings
  - instrumentation_gaps.json (committed): the gap queue and its dispositions
  - the explorer snapshot (committed): the area rollup, so the two pages cannot disagree

Runs in the analytics-governance workflow after the health step, which is what lets it
read a report that is never committed, and by hand:

  uv run governance_console_snapshot.py \
    -o ../../surfaces/governance-console/data/governance-console.json

The report is gitignored and lives 30 days as a CI artifact, so a local rebuild needs
`gh run download <run> --name analytics-event-health-report --dir instrumentation_data`
first, or the builder joins today's gap state onto a stale report and refuses.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path

PY = Path(__file__).resolve().parent
sys.path.insert(0, str(PY))

import analytics_event_health as aeh  # noqa: E402

GAPS = PY / "instrumentation_data" / "instrumentation_gaps.json"
REPORT = PY / "instrumentation_data" / "analytics_event_health_report.json"
EXPLORER = (
    PY.parent.parent.parent
    / "prototypes/app/p/analytics-event-explorer/data/event-explorer.json"
)

# A gap the sweep is still waiting on a ruling for. Everything else has been judged and
# belongs in `settled`, visible but out of the queue.
UNTRIAGED_GAPS = frozenset({"new", "open"})

# Ranks for the queues the health monitor does not rank. They sort below every flag,
# because a flag is a thing that broke and these are things that could be better.
PROPOSAL_RANK = 50
ALIGNMENT_RANK = 40

EVIDENCE_COLS = (
    "event_type", "status", "event_count_30d", "last_seen_date",
    "divergence", "instrumented_pr", "okr", "elevated",
)


class StaleReport(Exception):
    """The health report predates the committed state it would be joined with."""


# --- overview -----------------------------------------------------------------


def build_overview(report: Mapping, explorer: Mapping) -> dict:
    """Catalog rollup: totals, counts by status, counts by area, metadata coverage.

    The area rollup is lifted from the explorer snapshot rather than recomputed, so the
    two pages cannot disagree about which area an event belongs to. That filing rule has
    moved once already (DATA-2532) and having one producer is what stops it drifting.
    """
    coverage = dict(report.get("metadata_coverage") or {})
    scored = coverage.get("scored") or 0
    described = coverage.get("with_description") or 0
    coverage["described_pct"] = round(100 * described / scored) if scored else 0
    return {
        "totals": {
            "events": report.get("total_events") or 0,
            "flagged": len(report.get("flagged") or []),
        },
        "by_status": dict(report.get("status_counts") or {}),
        "by_area": list(explorer.get("areas") or []),
        "metadata_coverage": coverage,
    }


# --- the flags queue ----------------------------------------------------------


def build_flag_queue(report: Mapping) -> list[dict]:
    """The flagged set as one row per cause, in the digest's own grouping and order.

    A cause, not an event, is the unit: one deploy that stranded twenty-two name
    constants is one ruling, not twenty-two. ``aeh.cluster_flagged`` already does the
    grouping the digest prints, so the page and the digest cannot disagree about what a
    cause contains or what it is called.

    Unlike the digest this keeps the counter-blind-spot rows and the dormant tail in the
    same list. The digest splits them out because it is a push stream with a headline
    number to protect; the console is a pull surface where the whole state is the point.
    """
    records = list(report.get("flagged") or [])
    by_cause: dict[str, list[Mapping]] = {}
    for record in records:
        by_cause.setdefault(aeh.cause_key(record), []).append(record)

    dismissed = report.get("dismissed_causes") or {}
    items = []
    for group in aeh.cluster_flagged(records):
        cause = group["cause"]
        reason = dismissed.get(cause)
        items.append({
            "id": cause,
            "queue": "flags",
            "label": group["label"],
            "rank": group["rank"],
            "count": group["count"],
            "events": group["events"],
            "elevated": group["elevated"],
            "dismissable": cause.partition("@")[0] not in aeh.UNDISMISSABLE_CAUSES,
            "dismissed": {"reason": reason} if reason is not None else None,
            "evidence": [
                {col: record.get(col) for col in EVIDENCE_COLS}
                for record in sorted(by_cause.get(cause, []),
                                     key=lambda r: r["event_type"])
            ],
        })
    return items


# --- what changed -------------------------------------------------------------


def current_flagged_map(report: Mapping) -> dict[str, str]:
    """``{event_type: status}`` for this run's flagged set, the shape the diff compares."""
    return {r["event_type"]: r["status"] for r in (report.get("flagged") or [])}


def prior_flagged(previous: Mapping | None) -> dict[str, str] | None:
    """The previous snapshot's flagged map, or None when there is no previous snapshot.

    None and {} mean different things. None is a first run, where everything is new
    because nothing was ever seen. {} is a run where nothing was flagged, where
    everything is new because the catalog really was clean.
    """
    if previous is None:
        return None
    prior = previous.get("prior_flagged")
    return dict(prior) if isinstance(prior, dict) else None


def build_changes(report: Mapping, previous: Mapping | None) -> dict:
    """new / resolved / still_open / escalated against the previous snapshot.

    The snapshot is its own prior state: each one carries the flagged map of the run that
    produced it, and the next build reads the file it is about to replace. A second state
    file would be one more thing to keep in step for no gain.
    """
    return aeh.diff_flagged(list(report.get("flagged") or []), prior_flagged(previous))


# --- the other three queues ---------------------------------------------------


def _gap_item(gap: Mapping) -> dict:
    return {
        "id": gap["id"],
        "queue": "gaps",
        "label": gap.get("dashboard_question") or gap["id"],
        "rank": gap.get("rank", 99),
        "count": 1,
        "dismissable": True,
        "dismissed": ({"reason": gap.get("reason") or ""}
                      if gap.get("disposition") == "dismissed" else None),
        "evidence": [{
            "location": gap.get("location"),
            "surface_type": gap.get("surface_type"),
            "judge_reason": gap.get("judge_reason"),
            "rubric_rule": gap.get("rubric_rule"),
            "first_seen": gap.get("first_seen"),
            "last_seen": gap.get("last_seen"),
        }],
    }


def build_gap_queue(gaps: Mapping) -> list[dict]:
    """Untriaged instrumentation gaps, worst rank first. Judged rows go to ``settled``."""
    rows = [g for g in gaps.values() if g.get("disposition") in UNTRIAGED_GAPS]
    rows.sort(key=lambda g: (g.get("rank", 99), g["id"]))
    return [_gap_item(g) for g in rows]


def build_proposal_queue(report: Mapping) -> list[dict]:
    """Watchlist proposals: catalog events in a watched family not yet on the list."""
    return [{
        "id": p["event_type"],
        "queue": "proposals",
        "label": p["event_type"],
        "rank": PROPOSAL_RANK,
        "count": 1,
        "dismissable": True,
        "dismissed": None,
        "evidence": [{
            "family": p.get("family"),
            "first_seen_date": p.get("first_seen_date"),
        }],
    } for p in (report.get("proposals") or [])]


def build_alignment_queue(report: Mapping) -> list[dict]:
    """Registry-vs-semantic-layer findings.

    Case 1 is omni being behind the declaration, which is ours to fix and has no dismiss
    (`anchor_alignment`'s own rule). Cases 2 and 3 can be waved off with a `metric:` row.
    """
    return [{
        "id": f.get("key") or f.get("metric"),
        "queue": "alignment",
        "label": f"{f.get('metric')}: {f.get('summary') or f.get('case')}",
        "rank": ALIGNMENT_RANK,
        "count": 1,
        "dismissable": f.get("case") != 1,
        "dismissed": None,
        "evidence": [dict(f)],
    } for f in (report.get("anchor_alignment") or [])]


# --- the whole snapshot -------------------------------------------------------


def _settled_gaps(gaps: Mapping) -> list[dict]:
    rows = [g for g in gaps.values() if g.get("disposition") not in UNTRIAGED_GAPS]
    rows.sort(key=lambda g: g["id"])
    return [dict(_gap_item(g), disposition=g.get("disposition")) for g in rows]


def _newest_gap_date(gaps: Mapping) -> str:
    return max((g.get("last_seen") or "" for g in gaps.values()), default="")


def build_snapshot(
    report: Mapping, gaps: Mapping, explorer: Mapping, previous: Mapping | None
) -> dict:
    """Join every input into the one file the page renders.

    Refuses a report older than the committed gap state rather than building a snapshot
    that would misreport its own freshness. The report is the only gitignored input, so
    it is the only one that can silently be last week's.
    """
    run_date = report.get("run_date") or ""
    newest_gap = _newest_gap_date(gaps)
    if newest_gap and run_date and run_date < newest_gap:
        raise StaleReport(
            f"health report run_date {run_date} predates the committed gap state "
            f"({newest_gap}); refusing to build a snapshot that would misreport its own "
            "freshness. Download the report for this run first."
        )

    queues = [
        {"queue": "flags", "items": build_flag_queue(report)},
        {"queue": "gaps", "items": build_gap_queue(gaps)},
        {"queue": "proposals", "items": build_proposal_queue(report)},
        {"queue": "alignment", "items": build_alignment_queue(report)},
    ]
    overview = build_overview(report, explorer)
    overview["totals"]["open_decisions"] = sum(len(q["items"]) for q in queues)

    return {
        "run_date": run_date,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "health report + instrumentation gaps + explorer snapshot",
        "overview": overview,
        "changes": build_changes(report, previous),
        "queues": queues,
        "settled": _settled_gaps(gaps),
        "prior_flagged": current_flagged_map(report),
    }


# --- CLI ----------------------------------------------------------------------


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--gaps", type=Path, default=GAPS)
    parser.add_argument("--explorer", type=Path, default=EXPLORER)
    parser.add_argument("-o", "--out", type=Path, required=True)
    args = parser.parse_args(argv)

    for path in (args.report, args.gaps, args.explorer):
        if not path.exists():
            print(f"missing input: {path}", file=sys.stderr)
            return 1

    previous = _load(args.out) if args.out.exists() else None
    try:
        snapshot = build_snapshot(
            _load(args.report), _load(args.gaps), _load(args.explorer), previous
        )
    except StaleReport as exc:
        print(str(exc), file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(snapshot, indent=1, sort_keys=True) + "\n")
    counts = ", ".join(f"{q['queue']} {len(q['items'])}" for q in snapshot["queues"])
    print(f"wrote {args.out}")
    print(f"  run {snapshot['run_date']}: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
