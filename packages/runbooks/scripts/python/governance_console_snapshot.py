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
from datetime import date, datetime, timezone
from pathlib import Path

PY = Path(__file__).resolve().parent
sys.path.insert(0, str(PY))

import analytics_event_health as aeh  # noqa: E402

GAPS = PY / "instrumentation_data" / "instrumentation_gaps.json"
REPORT = PY / "instrumentation_data" / "analytics_event_health_report.json"
CODE_CSV = PY / "instrumentation_data" / "amplitude_event_provenance.csv"
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

# Each queue's verbs, in its own vocabulary, as {value: label}. Queue A's values are the
# literals instrumentation_gaps.apply_seed_dispositions validates against; inventing a
# shared set would mean translating on the way back in, and a typo there is silently
# skipped rather than refused.
FLAG_VERBS = {
    "govern": "Fix in Govern",
    "dismiss": "Dismiss cause",
    "ticket": "Ticket it",
    "investigate": "Look into it",
}

GAP_VERBS = {"accept": "Accept", "dismiss": "Dismiss", "defer": "Defer"}

PROPOSAL_VERBS = {
    "accept": "Add to watchlist",
    "dismiss": "Dismiss",
    "defer": "Defer",
}

ALIGNMENT_VERBS = {
    "fix_omni": "Fix in omni",
    "draft_upstream": "Draft upstream",
    "dismiss": "Dismiss",
    "defer": "Defer",
}

EVIDENCE_COLS = (
    "event_type", "status", "event_count_30d", "last_seen_date",
    "divergence", "instrumented_pr", "okr", "elevated",
)


class StaleReport(Exception):
    """The health report predates the committed state it would be joined with."""


# --- recommendations ----------------------------------------------------------
#
# Every row arrives with a suggested verb and the reason for it, the way
# /triage-instrumentation-gaps shows the judge's verdict before asking for one. The
# operator approves or overrides; nothing here decides anything on its own.
#
# The verbs are each queue's own vocabulary, not a shared one. Queue A's are the
# literals instrumentation_gaps.apply_seed_dispositions validates against, so a handoff
# needs no translation on the way back in.

# Most flagged causes resolve to a metadata write rather than an investigation: the code
# is gone and Govern still says in use. Where a cause can point either way, the
# recommendation is to look, not to write.
FLAG_RECOMMENDATIONS = {
    "call_site_removed": (
        "govern",
        "The call sites are gone and Govern still declares these in use. The fix is a "
        "retirement stamp per event.",
    ),
    "intent_divergence": (
        "govern",
        "The declared intent and the observed behaviour disagree. One of them is wrong "
        "and Govern is where it is corrected.",
    ),
    "orphaned_firing": (
        "investigate",
        "Two different faults share this signature: old clients draining after a real "
        "retirement, and a declaration that is simply wrong. Check last_seen per event "
        "before writing anything.",
    ),
    "counter_blind_spot": (
        "ticket",
        "This is our call-site counter failing to see an aliased or wrapped reference, "
        "not a product fault. It is fixed in count_call_sites, and it cannot be "
        "dismissed.",
    ),
    "okr_anchor_dormant": (
        "investigate",
        "A number the company steers by is wrong right now. It clears on recovery or "
        "when anchored_on changes upstream, and it cannot be dismissed.",
    ),
    "anomaly_drop": (
        "investigate",
        "A live event dropped without an obvious cause. Nothing to write until the "
        "cause is known.",
    ),
}


def recommend_flag(cause: str) -> tuple[str, str]:
    """Suggested verb for a flagged cause, plus why. Unknown causes get no suggestion.

    The three judgment causes (never_observed, dormant, dormant_elevated) deliberately
    have no recommendation: they are 112 of today's 174 flags and every one of them
    turns on product knowledge the monitor does not have.
    """
    base = cause.partition("@")[0]
    return FLAG_RECOMMENDATIONS.get(base, ("", ""))


def recommend_gap(gap: Mapping) -> tuple[str, str]:
    """Suggested verb for an instrumentation gap.

    A gap in the file has already passed the judge (only ``is_gap: true`` verdicts are
    folded into state), so the standing suggestion is accept. A prior ruling on a
    resplit predecessor overrides it, because that is a decision already made.
    """
    prior = gap.get("prior_ruling") or {}
    if prior.get("disposition") in ("accepted", "dismissed"):
        return (
            "accept" if prior["disposition"] == "accepted" else "dismiss",
            f"Ruled {prior['disposition']} at this location on "
            f"{prior.get('ruled_on') or 'an earlier run'}"
            + (f": {prior['reason']}" if prior.get("reason") else "")
            + ". Usually the same call.",
        )
    return ("accept", gap.get("judge_reason") or "The judge called this a real gap.")


ALIGNMENT_RECOMMENDATIONS = {
    1: ("fix_omni", "omni is behind the declaration, so the registry is what changes."),
    2: (
        "draft_upstream",
        "The declaration is behind the product. The output is a drafted anchored_on "
        "change for gp-data-platform, never an edit here.",
    ),
    3: (
        "investigate",
        "The two disagree on scope. A human settles it before it becomes a case 1 or a "
        "case 2.",
    ),
}


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


# --- code provenance ----------------------------------------------------------
#
# A blank PR link currently means three unrelated things, so the page names the state
# instead of showing an empty cell. The walk produces four outcomes and they carry
# different rulings: "instrumented last Thursday and quiet" is timing, "never found in
# code at all" is usually a runtime-built name or a backend event the walk does not
# cover, and those are not the same finding.
def provenance_state(row: Mapping | None) -> str:
    """How much the provenance walk knows about where this event was instrumented."""
    row = row or {}
    commit = bool(row.get("instrumented_commit"))
    pr = bool(row.get("instrumented_pr"))
    if commit and pr:
        return "full"
    if commit:
        # Mostly pre-monorepo: the (#123) in the subject does not resolve to an omni PR.
        return "commit only"
    if pr:
        # A hint written per-PR by instrument-analytics-event; the walk overwrites it.
        return "provisional"
    return "not found in code"


def _days_between(earlier: str | None, later: str | None) -> int | None:
    if not earlier or not later:
        return None
    try:
        return (date.fromisoformat(later) - date.fromisoformat(earlier)).days
    except ValueError:
        return None


def _elevated_note(members: Sequence[Mapping], elevated: Sequence[str]) -> str:
    """Why this cause has the elevation it has, so a column of blanks reads as a fact.

    ``is_elevated`` keys off curated-watchlist membership, the win_onboarding family,
    win_compliance_or* prefixes, or an onboarding / activation / compliance name.
    """
    total = len(members)
    if elevated:
        return (
            f"{len(elevated)} of {total} elevated: on the curated watchlist, or in an "
            "onboarding, activation or compliance family."
        )
    if all(not m.get("family") for m in members):
        return (
            "None elevated, and none can be: these have never fired, so they have no "
            "catalog row and no family for the elevation rules to read."
        )
    return (
        f"None of {total} elevated: not on the curated watchlist, and neither the "
        "family nor the name matches an onboarding, activation or compliance rule."
    )


# --- the flags queue ----------------------------------------------------------


def _verbs(verbs: Mapping[str, str], dismissable: bool) -> dict:
    """A row's verbs, minus dismiss where the loader would refuse it.

    Dropped rather than disabled: a button that cannot work is a promise the page
    cannot keep, and a dismissal written anyway does nothing except report itself in
    the next digest.
    """
    return {k: v for k, v in verbs.items() if dismissable or k != "dismiss"}


def _flag_evidence(record: Mapping, code: Mapping, run_date: str | None) -> dict:
    row = {col: record.get(col) for col in EVIDENCE_COLS}
    provenance = code.get(record["event_type"])
    instrumented = (provenance or {}).get("instrumented_date") or None
    row["instrumented_date"] = instrumented
    row["days_since_instrumented"] = _days_between(instrumented, run_date)
    row["provenance"] = provenance_state(provenance)
    return row


def _sorted_evidence(rows: list[dict]) -> list[dict]:
    """Oldest first, undated last, alphabetical within a tie.

    Age is the axis that splits a cause: on never-observed, two events silent since June
    sat sixty alphabetical rows below events instrumented last Thursday. Undated rows go
    last as their own block rather than being treated as infinitely old, because "never
    found in code" is a different finding from "old", and they read better together.
    """
    return sorted(
        rows,
        key=lambda r: (
            r["days_since_instrumented"] is None,
            -(r["days_since_instrumented"] or 0),
            r["event_type"],
        ),
    )


def build_flag_queue(report: Mapping, code: Mapping | None = None) -> list[dict]:
    """The flagged set as one row per cause, in the digest's own grouping and order.

    A cause, not an event, is the unit: one deploy that stranded twenty-two name
    constants is one ruling, not twenty-two. ``aeh.cluster_flagged`` already does the
    grouping the digest prints, so the page and the digest cannot disagree about what a
    cause contains or what it is called.

    Unlike the digest this keeps the counter-blind-spot rows and the dormant tail in the
    same list. The digest splits them out because it is a push stream with a headline
    number to protect; the console is a pull surface where the whole state is the point.
    """
    code = code or {}
    run_date = report.get("run_date")
    records = list(report.get("flagged") or [])
    by_cause: dict[str, list[Mapping]] = {}
    for record in records:
        by_cause.setdefault(aeh.cause_key(record), []).append(record)

    dismissed = report.get("dismissed_causes") or {}
    items = []
    for group in aeh.cluster_flagged(records):
        cause = group["cause"]
        reason = dismissed.get(cause)
        verdict, why = recommend_flag(cause)
        dismissable = cause.partition("@")[0] not in aeh.UNDISMISSABLE_CAUSES
        items.append({
            "id": cause,
            "queue": "flags",
            "verbs": _verbs(FLAG_VERBS, dismissable),
            "recommended": verdict,
            "recommendation_reason": why,
            "label": group["label"],
            "rank": group["rank"],
            "count": group["count"],
            "events": group["events"],
            "elevated": group["elevated"],
            "dismissable": dismissable,
            "dismissed": {"reason": reason} if reason is not None else None,
            "elevated_note": _elevated_note(
                by_cause.get(cause, []), group["elevated"]
            ),
            "evidence": _sorted_evidence(
                [_flag_evidence(record, code, run_date)
                 for record in by_cause.get(cause, [])]
            ),
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
    verdict, why = recommend_gap(gap)
    return {
        "id": gap["id"],
        "queue": "gaps",
        "verbs": GAP_VERBS,
        "recommended": verdict,
        "recommendation_reason": why,
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
        "verbs": PROPOSAL_VERBS,
        "recommended": "accept",
        "recommendation_reason": (
            "A live event in a watched family that is not on the list. The list exists "
            "to watch this family, so the default is to watch it."
        ),
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
        "verbs": _verbs(ALIGNMENT_VERBS, f.get("case") != 1),
        "recommended": ALIGNMENT_RECOMMENDATIONS.get(f.get("case"), ("", ""))[0],
        "recommendation_reason": ALIGNMENT_RECOMMENDATIONS.get(
            f.get("case"), ("", "")
        )[1],
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
    report: Mapping,
    gaps: Mapping,
    explorer: Mapping,
    previous: Mapping | None,
    code: Mapping | None = None,
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
        {"queue": "flags", "items": build_flag_queue(report, code)},
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
    parser.add_argument("--code", type=Path, default=CODE_CSV)
    parser.add_argument("-o", "--out", type=Path, required=True)
    args = parser.parse_args(argv)

    for path in (args.report, args.gaps, args.explorer, args.code):
        if not path.exists():
            print(f"missing input: {path}", file=sys.stderr)
            return 1

    previous = _load(args.out) if args.out.exists() else None
    try:
        snapshot = build_snapshot(
            _load(args.report),
            _load(args.gaps),
            _load(args.explorer),
            previous,
            aeh.load_code_axis(args.code),
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
