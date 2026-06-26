"""Analytics event health monitor — reconcile event status across three axes (DATA-1952).

Reconciles every Amplitude event across three axes — declared intent (``gp-meta`` parsed
from the Govern description), code presence (the committed git-provenance CSV that lives
beside this script in ``instrumentation_data/``), and firing volume (the event catalog plus
a trailing weekly aggregate of the raw stream) — classifies each against the
analytics-event-change SOP status model, detects firing-volume anomalies, and renders a
severity-ranked digest section appended to ``instrumentation_data/event-health-log.md``.

Hybrid scope: every catalog event gets an SOP status; a curated watchlist
(``monitored_events.yaml``) drives severity elevation and the self-healing proposal queue
(new events in watched families that are not yet on the list). The deeper per-flag code
investigation (reading the diffs) is the runbook agent's job — see books/monitor-event-health.md.

It READS from Databricks (the catalog ``int__amplitude_event_catalog`` and the raw stream
``stg_airbyte_source__amplitude_api_events``, via OAuth in ``databricks_oauth`` — no PAT) for
the firing axis, and the provenance CSV for the code axis. It WRITES nothing back to
Amplitude; the CLI emits a markdown digest section and a JSON result.

The pure functions (``parse_gpmeta``, ``is_system``, ``is_elevated``, ``detect_anomaly``,
``classify_status``, ``reconcile``, ``propose_watchlist_additions``, ``rank_record``,
``diff_flagged``, ``render_digest_section``) take plain data and have no IO, so they are
unit-tested with fixtures. Only ``fetch_*``, ``load_*`` and ``main`` touch Databricks / disk.

Usage:
    cd packages/runbooks/scripts/python && uv run analytics_event_health.py
    uv run analytics_event_health.py --json /tmp/result.json --today 2026-06-26
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml

# --- locations ---------------------------------------------------------------

CATALOG = "goodparty_data_catalog"
CATALOG_TABLE = f"{CATALOG}.dbt.int__amplitude_event_catalog"
STREAM_TABLE = f"{CATALOG}.dbt.stg_airbyte_source__amplitude_api_events"
HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "instrumentation_data"

# Code axis (provenance): the authoritative, kept-current CSV produced by
# amplitude_event_provenance_backfill.py, in this package's instrumentation_data/.
CODE_CSV = DATA_DIR / "amplitude_event_provenance.csv"
WATCHLIST = HERE / "monitored_events.yaml"
DEFAULT_STATE = DATA_DIR / "analytics_event_health_state.json"
DEFAULT_LOG = DATA_DIR / "event-health-log.md"

# --- thresholds (SOP recommended defaults; tunable, pending Eng) --------------

DORMANT_DAYS = 30
RETIREMENT_FLOOR_PCT = 0.05  # current week below this fraction of baseline = anomaly drop
ABSOLUTE_FLOOR = 5  # baseline fires/week below which a drop-to-zero rule replaces the %
MIN_BASELINE_WEEKS = 5  # need >= current + 4 baseline complete weeks to judge an anomaly
PROPOSAL_WINDOW_DAYS = 90  # surface watched-family events first seen within this window

# --- classification vocab -----------------------------------------------------

# Families always treated as onboarding/activation/compliance for severity elevation,
# independent of the curated watchlist. The watchlist's `watched_families` extend the
# coverage scope (proposals + anomaly attention) but elevation stays funnel-focused:
# an event elevates if it is on the curated watchlist, in one of these families, or its
# text reads as onboarding/activation.
ELEVATED_FAMILIES = {"win_onboarding"}
ELEVATED_FAMILY_PREFIXES = ("win_compliance_or",)
ELEVATION_TEXT = re.compile(
    r"onboard|activat|getting started|welcome|sign ?up|registration|compliant",
    re.IGNORECASE,
)
# System / auto-tracked events: no one declares intent for these, so Active/Dormant is
# meaningless. They are anomaly-watched only (a page-view drop still means tracking broke)
# but never appear as a status flag.
SYSTEM_FAMILIES = {"amplitude_autotrack", "session_or_browser"}
SYSTEM_NAME = re.compile(
    r"^gtm\.|^\[Amplitude\]|^\[AI Visibility\]|^Viewed /|^page$|^page_view$"
    r"|^page viewed$|^screen$|^likelihood-to-cancel$",
    re.IGNORECASE,
)
GPMETA = re.compile(r"<!--\s*gp-meta\s*-->(.*?)<!--\s*/gp-meta\s*-->", re.DOTALL)

# --- SQL ----------------------------------------------------------------------

CATALOG_SQL = f"""
select event_type, family, is_win, first_seen_date, last_seen_date,
       event_count, event_count_30d, govern_description, in_govern_taxonomy
from {CATALOG_TABLE}
"""

WEEKLY_SQL = f"""
select event_type,
       date_trunc('week', cast(event_time as date)) as week_start,
       count(*) as n
from {STREAM_TABLE}
where cast(event_time as date) >= date_sub(current_date(), 63)
  and event_type is not null
group by event_type, date_trunc('week', cast(event_time as date))
"""

# Provenance CSV column carrying the code-removed date (empty = code still present).
RETIRED_COL = "retired_date"
INSTRUMENTED_PR_COL = "instrumented_pr"


# --- pure helpers -------------------------------------------------------------


def to_date(value: Any) -> date | None:
    """Coerce a date / datetime / ISO string to a ``date`` (``datetime`` checked first
    because it subclasses ``date``). Empty / None -> None."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def parse_gpmeta(description: str | None) -> dict | None:
    """Parse the ``<!-- gp-meta -->`` block from a Govern description.

    Returns ``{"intent": "in_use"|"not_in_use"|None, "supersession": str|None}`` or
    ``None`` when no block is present. Sparse today; the logic is ready for when the
    instrument-analytics-event / event-metadata skills start writing it.
    """
    if not description:
        return None
    match = GPMETA.search(description)
    if not match:
        return None
    block = match.group(1)
    intent = None
    if re.search(r"^\s*not in use", block, re.IGNORECASE | re.MULTILINE):
        intent = "not_in_use"
    elif re.search(r"^\s*in use", block, re.IGNORECASE | re.MULTILINE):
        intent = "in_use"
    sup = re.search(r"supersession:\s*(.+)", block, re.IGNORECASE)
    return {"intent": intent, "supersession": sup.group(1).strip() if sup else None}


def is_system(family: str | None, event_type: str | None) -> bool:
    """True for auto-tracked / system events excluded from status flagging."""
    if family in SYSTEM_FAMILIES:
        return True
    return bool(SYSTEM_NAME.search(event_type or ""))


def has_description(description: str | None) -> bool:
    """True when the Govern description carries real text (not null, not blank/whitespace).

    Many events are blank pending the historical metadata backfill, so this tracks which
    events still need a hand-written description (the onboarding / activation ones first).
    """
    return bool(description and description.strip())


def is_elevated(
    family: str | None,
    event_type: str | None,
    description: str | None,
    on_watchlist: bool = False,
) -> bool:
    """True for curated-watchlist or onboarding / activation / compliance events.

    Surfaced higher in the digest. ``on_watchlist`` is the curated-list membership; the
    family / text rules cover events not (yet) on the list.
    """
    if on_watchlist:
        return True
    if family in ELEVATED_FAMILIES:
        return True
    if family and any(family.startswith(p) for p in ELEVATED_FAMILY_PREFIXES):
        return True
    return bool(ELEVATION_TEXT.search(f"{event_type or ''} {description or ''}"))


def detect_anomaly(weeks: Sequence[tuple[date, int]]) -> dict | None:
    """Flag a firing-volume drop in the latest complete week vs the trailing baseline.

    ``weeks`` is ascending ``(week_start, count)`` over complete weeks only. The current
    week is the last entry; the baseline is the mean of the four weeks before it. A drop
    is flagged below ``RETIREMENT_FLOOR_PCT`` of the baseline (or any fall to zero when the
    baseline is below ``ABSOLUTE_FLOOR``). Returns ``{"current", "baseline"}`` or ``None``.
    """
    if len(weeks) < MIN_BASELINE_WEEKS:
        return None
    current = weeks[-1][1]
    baseline_vals = [n for _, n in weeks[-MIN_BASELINE_WEEKS:-1]]
    baseline = sum(baseline_vals) / len(baseline_vals)
    if baseline <= 0:
        return None
    drop = current == 0 if baseline < ABSOLUTE_FLOOR else current < RETIREMENT_FLOOR_PCT * baseline
    return {"current": current, "baseline": round(baseline, 1)} if drop else None


def classify_status(
    *,
    in_code: bool | None,
    firing_recent: bool,
    retired_date: date | None,
    today: date,
) -> str:
    """SOP status from the code x firing axes. ``in_code`` is None when the event has no
    provenance row (code axis unknown: auto-tracked or brand-new)."""
    if in_code is None:
        return "code_unknown"
    if retired_date is None:  # code present
        return "active" if firing_recent else "dormant"
    if firing_recent:  # code removed but still firing
        return "orphaned_firing"
    return "deprecating" if (today - retired_date).days <= DORMANT_DAYS else "retired"


def divergence(gpmeta: dict | None, status: str, firing_recent: bool) -> str | None:
    """Intent-vs-reality divergence note from gp-meta, or None. (gp-meta sparse today.)"""
    if not gpmeta:
        return None
    if gpmeta["intent"] == "in_use" and status in ("retired", "deprecating"):
        return "declared in-use but code removed + quiet"
    if gpmeta["intent"] == "not_in_use" and firing_recent:
        return "declared not-in-use but still firing"
    return None


def rank_record(record: Mapping[str, Any]) -> int:
    """Digest severity rank (1 = highest). 99 = not flagged."""
    status, elevated, anomaly = record["status"], record["elevated"], record["anomaly"]
    div = record["divergence"] or ""
    if status == "orphaned_firing" or div.endswith("still firing"):
        return 1
    if anomaly and status == "active" and elevated:
        return 2
    if anomaly and status in ("active", "system"):
        return 3
    if div.startswith("declared"):
        return 4
    if status == "dormant" and elevated:
        return 5
    if status == "instrumented_never_observed":
        return 6
    if status == "dormant":
        return 7
    return 99


def weekly_series(
    weekly_rows: Iterable[Mapping[str, Any]], current_monday: date
) -> dict[str, list[tuple[date, int]]]:
    """Group raw weekly counts into ascending complete-week series per event_type.

    Excludes the in-progress week (any ``week_start`` on or after ``current_monday``).
    """
    by_event: dict[str, dict[date, int]] = defaultdict(dict)
    for row in weekly_rows:
        week = to_date(row["week_start"])
        if week and week < current_monday:
            by_event[row["event_type"]][week] = int(row["n"])
    return {et: sorted(weeks.items()) for et, weeks in by_event.items()}


def propose_watchlist_additions(
    catalog: Sequence[Mapping[str, Any]],
    watched_families: Iterable[str],
    watchlist_events: Iterable[str],
    today: date,
    window_days: int = PROPOSAL_WINDOW_DAYS,
) -> list[dict]:
    """Self-healing watchlist: catalog events in a watched family, first seen within the
    window, not already on the curated list and not system/auto-tracked.

    Returns ``[{event_type, family, first_seen_date}]`` newest-first — the proposal queue
    the runbook triages with a human before adding rows to ``monitored_events.yaml``.
    """
    watched_families = set(watched_families)
    watchlist_events = set(watchlist_events)
    cutoff = today - timedelta(days=window_days)
    out: list[dict] = []
    for row in catalog:
        event_type = row["event_type"]
        family = row["family"]
        if family not in watched_families or event_type in watchlist_events:
            continue
        if is_system(family, event_type):
            continue
        first_seen = to_date(row.get("first_seen_date"))
        if first_seen is None or first_seen < cutoff:
            continue
        out.append({"event_type": event_type, "family": family, "first_seen_date": first_seen})
    return sorted(out, key=lambda r: (r["first_seen_date"], r["event_type"]), reverse=True)


def reconcile(
    catalog: Sequence[Mapping[str, Any]],
    weekly_rows: Iterable[Mapping[str, Any]],
    code: Mapping[str, Mapping[str, Any]],
    today: date,
    watchlist_events: Iterable[str] = (),
    watched_families: Iterable[str] = (),
) -> dict:
    """Reconcile the three axes into per-event records, status counts, a ranked flag list,
    and the self-healing watchlist proposal queue."""
    current_monday = today - timedelta(days=today.weekday())
    series = weekly_series(weekly_rows, current_monday)
    watchlist_events = set(watchlist_events)
    seen_in_catalog = {row["event_type"] for row in catalog}
    records: list[dict] = []

    for row in catalog:
        event_type = row["event_type"]
        family = row["family"]
        description = row["govern_description"]
        cnt30 = int(row["event_count_30d"] or 0)
        firing_recent = cnt30 > 0
        crow = code.get(event_type)
        gpmeta = parse_gpmeta(description)
        anomaly = detect_anomaly(series.get(event_type, []))
        on_watchlist = event_type in watchlist_events

        if is_system(family, event_type):
            status = "system"  # anomaly-watched only
        else:
            in_code = None if crow is None else True
            retired = to_date(crow.get(RETIRED_COL)) if crow else None
            status = classify_status(
                in_code=in_code, firing_recent=firing_recent, retired_date=retired, today=today
            )

        records.append(
            {
                "event_type": event_type,
                "family": family,
                "status": status,
                "elevated": is_elevated(family, event_type, description, on_watchlist=on_watchlist),
                "on_watchlist": on_watchlist,
                "event_count_30d": cnt30,
                "last_seen_date": to_date(row["last_seen_date"]),
                "anomaly": anomaly,
                "instrumented_pr": (crow or {}).get(INSTRUMENTED_PR_COL),
                "divergence": divergence(gpmeta, status, firing_recent),
                "gpmeta": gpmeta,
                "has_description": has_description(description),
            }
        )

    # instrumented but never observed: present in the code axis, absent from the catalog
    for event_type, crow in code.items():
        if event_type not in seen_in_catalog and not to_date(crow.get(RETIRED_COL)):
            records.append(
                {
                    "event_type": event_type,
                    "family": None,
                    "status": "instrumented_never_observed",
                    "elevated": is_elevated(None, event_type, None),
                    "on_watchlist": event_type in watchlist_events,
                    "event_count_30d": 0,
                    "last_seen_date": None,
                    "anomaly": None,
                    "instrumented_pr": crow.get(INSTRUMENTED_PR_COL),
                    "divergence": None,
                    "gpmeta": None,
                    "has_description": None,  # not an Amplitude catalog event; no Govern desc
                }
            )

    for record in records:
        record["rank"] = rank_record(record)
    flagged = sorted(
        (r for r in records if r["rank"] < 99),
        key=lambda r: (r["rank"], -r["event_count_30d"]),
    )
    status_counts: dict[str, int] = defaultdict(int)
    for record in records:
        status_counts[record["status"]] += 1

    # Description completeness: scored over real Amplitude catalog events, excluding system /
    # auto-tracked (we don't curate those). Elevated gaps are listed to backfill first; the
    # rest are counted only, so the digest is not buried by the pending historical backfill.
    scored = [r for r in records if r["status"] != "system" and r["has_description"] is not None]
    elevated_missing = sorted(r["event_type"] for r in scored if not r["has_description"] and r["elevated"])
    metadata_coverage = {
        "scored": len(scored),
        "with_description": sum(1 for r in scored if r["has_description"]),
        "elevated_missing": elevated_missing,
        "other_missing_count": sum(1 for r in scored if not r["has_description"] and not r["elevated"]),
    }

    proposals = propose_watchlist_additions(catalog, watched_families, watchlist_events, today)

    return {
        "run_date": today,
        "current_week_basis": f"complete weeks before {current_monday}",
        "total_events": len(records),
        "status_counts": dict(status_counts),
        "metadata_coverage": metadata_coverage,
        "proposals": proposals,
        "flagged": flagged,
        "records": records,
    }


def diff_flagged(
    flagged: Sequence[Mapping[str, Any]], prior: Mapping[str, str] | None
) -> dict[str, list[str]]:
    """Diff the current flagged set against a prior ``{event_type: status}`` map.

    Returns ``{"new", "resolved", "still_open"}`` lists of event_types. ``prior`` None
    (first run) -> everything is new.
    """
    current = {r["event_type"]: r["status"] for r in flagged}
    if prior is None:
        return {"new": sorted(current), "resolved": [], "still_open": []}
    return {
        "new": sorted(e for e in current if e not in prior),
        "resolved": sorted(e for e in prior if e not in current),
        "still_open": sorted(e for e in current if e in prior),
    }


# --- rendering ----------------------------------------------------------------

_RANK_LABEL = {
    1: "orphaned-firing / not-in-use still firing",
    2: "anomaly drop, active (elevated)",
    3: "anomaly drop, active",
    4: "intent divergence",
    5: "dormant (elevated)",
    6: "instrumented, never observed",
    7: "dormant",
}


def _evidence(record: Mapping[str, Any]) -> str:
    parts = [f"30d={record['event_count_30d']}"]
    if record["anomaly"]:
        parts.append(f"week {record['anomaly']['current']} vs base {record['anomaly']['baseline']}")
    if record["last_seen_date"]:
        parts.append(f"last_seen {record['last_seen_date']}")
    if record["instrumented_pr"]:
        parts.append(f"PR {record['instrumented_pr']}")
    return "; ".join(parts)


# Rank-7 (plain dormant) events are listed as one compact line, not table rows: there are
# routinely dozens and they repeat every weekly section, so a full table would bury the
# priority flags above. Anything rank <= this threshold gets a detailed row.
PRIORITY_RANK_MAX = 6
# Cap how many event names a single changes-line spells out before summarizing (the
# first run flags everything, which would otherwise dump the whole list).
CHANGES_NAME_CAP = 15
# Cap how many self-healing proposals to spell out as ready-to-paste rows.
PROPOSAL_CAP = 15


def _changes_line(label: str, names: list[str]) -> str:
    if not names:
        return f"- {label}: none"
    if len(names) > CHANGES_NAME_CAP:
        return f"- {label}: {len(names)} (see flagged table)"
    return f"- {label}: {', '.join(names)}"


def _proposal_yaml_row(proposal: Mapping[str, Any]) -> str:
    family = proposal["family"] or ""
    product = "win" if str(family).startswith("win") else "serve"
    return (
        f'  - {{event: "{proposal["event_type"]}", product: {product}, '
        f"family: {family}, floor: null, owner: TBD}}"
    )


def render_digest_section(result: Mapping[str, Any], changes: Mapping[str, list[str]]) -> str:
    """Render one dated markdown digest section to append to the log."""
    sc = result["status_counts"]
    flagged = result["flagged"]
    priority = [r for r in flagged if r["rank"] <= PRIORITY_RANK_MAX]
    tail = [r for r in flagged if r["rank"] > PRIORITY_RANK_MAX]
    lines = [
        f"## {result['run_date']}",
        "",
        f"Basis: {result['current_week_basis']}. "
        f"{result['total_events']} events — "
        + ", ".join(f"{k} {v}" for k, v in sorted(sc.items(), key=lambda x: -x[1]))
        + f". {len(flagged)} flagged ({len(priority)} priority, {len(tail)} dormant tail).",
        "",
        "### Flagged (ranked)",
        "",
        "| rank | event | status | elev | evidence | divergence |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in priority:
        elev = "yes" if r["elevated"] else ""
        lines.append(
            f"| {r['rank']} {_RANK_LABEL.get(r['rank'], '')} | {r['event_type']} | "
            f"{r['status']} | {elev} | {_evidence(r)} | {r['divergence'] or ''} |"
        )
    if tail:
        names = " · ".join(r["event_type"] for r in tail)
        lines += [
            "",
            f"**Dormant tail ({len(tail)})** — code present, 0 fires/30d, not elevated: {names}",
        ]
    lines += [
        "",
        "### Changes since last run",
        "",
        _changes_line("new", changes["new"]),
        _changes_line("resolved", changes["resolved"]),
        f"- still open: {len(changes['still_open'])} event(s)",
    ]

    mc = result.get("metadata_coverage")
    if mc:
        scored, with_desc = mc["scored"], mc["with_description"]
        pct = round(100 * with_desc / scored) if scored else 0
        missing = " · ".join(mc["elevated_missing"]) or "none"
        lines += [
            "",
            "### Metadata completeness (description field)",
            "",
            f"- Non-system events with a description: {with_desc}/{scored} ({pct}%). "
            "Remaining are blank pending the historical backfill.",
            f"- Onboarding / activation / compliance missing a description (fill first): {missing}",
            f"- Other non-system events missing a description: {mc['other_missing_count']} (not listed).",
        ]

    proposals = result.get("proposals") or []
    if proposals:
        shown = proposals[:PROPOSAL_CAP]
        lines += [
            "",
            "### Watchlist proposals (self-healing)",
            "",
            f"{len(proposals)} event(s) in a watched family, first seen in the last "
            f"{PROPOSAL_WINDOW_DAYS}d, not yet on the watchlist. Triage in the runbook "
            "(add real funnel/activation milestones; skip UI micro-interactions), confirm "
            "in code, then paste the agreed rows into `monitored_events.yaml`:",
            "",
            "```yaml",
            *[_proposal_yaml_row(p) for p in shown],
            "```",
        ]
        if len(proposals) > PROPOSAL_CAP:
            lines.append(f"({len(proposals) - PROPOSAL_CAP} more — see the JSON report.)")
    lines.append("")
    return "\n".join(lines)


# --- IO + CLI -----------------------------------------------------------------


def load_watchlist(path: Path = WATCHLIST) -> tuple[list[str], list[str]]:
    """Read ``monitored_events.yaml`` -> ``(watched_families, watchlist_event_names)``."""
    if not path.exists():
        return [], []
    doc = yaml.safe_load(path.read_text()) or {}
    families = doc.get("watched_families", []) or []
    events = [row["event"] for row in (doc.get("events", []) or []) if row.get("event")]
    return families, events


def load_code_axis(csv_path: Path = CODE_CSV) -> dict[str, dict]:
    """Read the committed provenance CSV into ``{event_type: row}`` (the code axis)."""
    with open(csv_path, newline="") as fh:
        return {row["event_type"]: row for row in csv.DictReader(fh)}


def _records_from_df(df: Any) -> list[dict]:
    return df.to_dict("records")


def fetch_catalog(run_query: Callable[[str], Any]) -> list[dict]:
    return _records_from_df(run_query(CATALOG_SQL))


def fetch_weekly(run_query: Callable[[str], Any]) -> list[dict]:
    return _records_from_df(run_query(WEEKLY_SQL))


def load_prior_state(path: Path | None) -> dict[str, str] | None:
    if not path or not path.exists():
        return None
    return json.loads(path.read_text()).get("flagged")


def run_monitor(
    run_query: Callable[[str], Any],
    *,
    today: date,
    csv_path: Path = CODE_CSV,
    watchlist_path: Path = WATCHLIST,
    state_path: Path | None = None,
) -> tuple[dict, dict[str, list[str]]]:
    """Orchestrate a full pass: fetch the two queries, read the code axis + watchlist,
    reconcile, diff."""
    catalog = fetch_catalog(run_query)
    weekly = fetch_weekly(run_query)
    code = load_code_axis(csv_path)
    watched_families, watchlist_events = load_watchlist(watchlist_path)
    result = reconcile(catalog, weekly, code, today, watchlist_events, watched_families)
    changes = diff_flagged(result["flagged"], load_prior_state(state_path))
    return result, changes


def _json_default(obj: Any) -> str:
    if isinstance(obj, date):
        return obj.isoformat()
    raise TypeError(f"not serializable: {type(obj)}")


def append_log(log_path: Path, section: str) -> None:
    """Append one dated digest section to the growing longitudinal log."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a") as fh:
        fh.write("\n" + section if log_path.exists() and log_path.stat().st_size else section)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analytics event health monitor (DATA-1952).")
    parser.add_argument("--csv", type=Path, default=CODE_CSV, help="provenance CSV (code axis)")
    parser.add_argument("--watchlist", type=Path, default=WATCHLIST, help="curated watchlist YAML")
    parser.add_argument("--json", type=Path, help="also write the full result JSON here")
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG, help="longitudinal log to append to")
    parser.add_argument("--no-log", action="store_true", help="do not append to the log")
    parser.add_argument(
        "--state",
        type=Path,
        default=DEFAULT_STATE,
        help="prior-run state JSON for the changes diff (default: instrumentation_data/)",
    )
    parser.add_argument("--today", help="override run date (YYYY-MM-DD); default = system date")
    args = parser.parse_args(argv)

    import databricks_oauth as dbc

    today = datetime.strptime(args.today, "%Y-%m-%d").date() if args.today else date.today()
    result, changes = run_monitor(
        dbc.run_query,
        today=today,
        csv_path=args.csv,
        watchlist_path=args.watchlist,
        state_path=args.state,
    )

    section = render_digest_section(result, changes)
    sys.stdout.write(section)

    if not args.no_log:
        append_log(args.log, section)
    if args.json:
        args.json.write_text(json.dumps(result, indent=2, default=_json_default) + "\n")
    if args.state:
        state = {
            "run_date": today.isoformat(),
            "flagged": {r["event_type"]: r["status"] for r in result["flagged"]},
        }
        args.state.write_text(json.dumps(state, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
