"""Analytics event health monitor — reconcile event status across three axes (DATA-1952).

Reconciles every Amplitude event across three axes — declared intent (``gp-meta`` parsed
from the Govern description), code presence (the committed git-provenance CSV that lives
beside this script in ``instrumentation_data/``), and firing volume (the event catalog plus
a trailing weekly aggregate of the raw stream) — classifies each against the
analytics-event-change SOP status model, detects firing-volume anomalies, and renders a
severity-ranked digest section prepended (newest first, below the header) to
``instrumentation_data/analytics-event-health-log.md``.

Hybrid scope: every catalog event gets an SOP status; a curated watchlist
(``monitored_events.yaml``) drives severity elevation and the self-healing proposal queue
(new events in watched families that are not yet on the list). The deeper per-flag code
investigation (reading the diffs) is the runbook agent's job — see books/monitor-analytics-event-health.md.

It READS from Databricks (the ``mart_analytics`` exposures ``amplitude_event_catalog`` and the
event stream ``amplitude_events``, via OAuth in ``databricks_oauth`` — no PAT) for
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
import os
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
# Read through mart_analytics exposures so access is granted at the mart schema,
# not on individual dbt relations (dbt owns the models, Terraform owns the grant).
CATALOG_TABLE = f"{CATALOG}.mart_analytics.amplitude_event_catalog"
STREAM_TABLE = f"{CATALOG}.mart_analytics.amplitude_events"
HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "instrumentation_data"

# Code axis (provenance): the authoritative, kept-current CSV produced by
# amplitude_event_provenance_backfill.py, in this package's instrumentation_data/.
CODE_CSV = DATA_DIR / "amplitude_event_provenance.csv"
WATCHLIST = HERE / "monitored_events.yaml"
DEFAULT_STATE = DATA_DIR / "analytics_event_health_state.json"
DEFAULT_LOG = DATA_DIR / "analytics-event-health-log.md"

# --- thresholds (SOP recommended defaults; tunable, pending Eng) --------------

DORMANT_DAYS = 30
# Grace after a lifecycle date (code retirement, or a gp-meta not-in-use declaration) before
# trailing traffic counts as "still firing after" that date. Absorbs deploy lag (merge -> prod
# rollout), the short client-cache drain tail, and Amplitude ingestion lag on last_seen. A
# genuine orphan (stale clients emitting a removed event) keeps firing for weeks, well past this
# window, so it is still caught; only the expected boundary tail is suppressed. (tunable, pending Eng)
ORPHAN_GRACE_DAYS = 2
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

# The 63-day window is relative to warehouse current_date(), independent of --today: the
# firing axis is always live, so --today shifts only the local week math, not this query.
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
CALL_SITE_COUNT_COL = "call_site_count"
CALL_SITE_RETIRED_COL = "call_site_retired_date"


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

    Returns ``{"intent": "in_use"|"not_in_use"|None, "intent_date": str|None,
    "supersession": str|None, "purpose": str|None}`` (``intent_date`` is the YYYY-MM-DD on
    the in-use / not-in-use status line) or ``None`` when no block is present. Sparse today; the logic is ready for when the
    instrument-analytics-event / event-metadata skills start writing it.
    """
    if not description:
        return None
    match = GPMETA.search(description)
    if not match:
        return None
    block = match.group(1)
    intent = None
    status_line = re.search(r"^\s*not in use[^\n]*", block, re.IGNORECASE | re.MULTILINE)
    if status_line:
        intent = "not_in_use"
    else:
        status_line = re.search(r"^\s*in use[^\n]*", block, re.IGNORECASE | re.MULTILINE)
        if status_line:
            intent = "in_use"
    intent_date = None
    if status_line:
        d = re.search(r"\d{4}-\d{2}-\d{2}", status_line.group(0))
        intent_date = d.group(0) if d else None
    sup = re.search(r"supersession:\s*(.+)", block, re.IGNORECASE)
    # Purpose: the first content line that is neither a known field nor an in/out-of-use
    # status line. Trailing " |" (the gp-meta line separator) is stripped.
    purpose = None
    for raw in block.splitlines():
        line = raw.strip()
        if not line:
            continue
        if re.match(r"^(supersession|in use|not in use|change-set)\b", line, re.IGNORECASE):
            continue
        purpose = line.rstrip().removesuffix("|").rstrip()
        break
    return {
        "intent": intent,
        "intent_date": intent_date,
        "supersession": sup.group(1).rstrip().removesuffix("|").rstrip() if sup else None,
        "purpose": purpose,
    }


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
    last_seen_date: date | None,
    today: date,
) -> str:
    """SOP status from the code x firing axes. ``in_code`` is None when the event has no
    provenance row (code axis unknown: auto-tracked or brand-new)."""
    if in_code is None:
        return "code_unknown"
    if retired_date is None:  # code present
        return "active" if firing_recent else "dormant"
    # Code removed. "Still firing" (orphaned) requires firing AFTER retirement, not merely a
    # nonzero 30-day count: that window straddles the retirement date, so pre-retirement traffic
    # would false-alarm every fresh retiree with prior volume as orphaned for up to 30 days
    # (DATA-2140). Gate on last_seen past retirement + a grace window for deploy/pipeline lag. A
    # missing last_seen (Databricks catalog data gap) is ambiguous, so fall back to firing_recent
    # rather than hiding a genuine orphan behind a null date.
    fired_after_retirement = last_seen_date is None or (
        last_seen_date > retired_date + timedelta(days=ORPHAN_GRACE_DAYS)
    )
    if firing_recent and fired_after_retirement:
        return "orphaned_firing"
    return "deprecating" if (today - retired_date).days <= DORMANT_DAYS else "retired"


def divergence(
    gpmeta: dict | None,
    status: str,
    firing_recent: bool,
    last_seen_date: date | None = None,
) -> str | None:
    """Intent-vs-reality divergence note from gp-meta, or None. (gp-meta sparse today.)"""
    if not gpmeta:
        return None
    if gpmeta["intent"] == "in_use" and status in ("retired", "deprecating"):
        return "declared in-use but code removed + quiet"
    if gpmeta["intent"] == "not_in_use" and firing_recent:
        # "Still firing" must mean fired AFTER the not-in-use declaration, not merely a nonzero
        # 30-day count straddling that date (the same trap as orphaned_firing, DATA-2140). A missing
        # declaration date, or a missing last_seen (Databricks data gap), is ambiguous — fall back to
        # the firing_recent signal rather than hiding a genuine divergence behind a null date.
        intent_date = to_date(gpmeta.get("intent_date"))
        if intent_date is None or last_seen_date is None or (
            last_seen_date > intent_date + timedelta(days=ORPHAN_GRACE_DAYS)
        ):
            return "declared not-in-use but still firing"
    return None


def rank_record(record: Mapping[str, Any]) -> int:
    """Digest severity rank (0 = highest). 99 = not flagged."""
    status, elevated, anomaly = record["status"], record["elevated"], record["anomaly"]
    div = record["divergence"] or ""
    # DATA-2106 canary: a client event firing normally (active, no anomaly) with zero counted
    # call sites is a contradiction -- the data axis says alive, the code axis says gone. The
    # counter is blind (an aliased or Prettier-wrapped reference it cannot see), not the
    # event dead: a tooling alert, never the rank-2 retirement path. An anomaly drop
    # alongside the zero is instead the signature of a genuine recent removal (counts
    # draining after the call site went away) and falls through to rank 2 below.
    if record.get("call_site_count") == 0 and status == "active" and not anomaly:
        return 0
    if status == "orphaned_firing" or div.endswith("still firing"):
        return 1
    # DATA-2046: the name literal is still declared (status active/dormant) but the call site
    # is gone (call_site_count == 0) and firing has flatlined (dormant, or an anomaly drop on
    # still-"active" code). A removed call site behind a surviving constant. Null call_site_count
    # (backend/dynamic, unresolved) is not zero and never trips this. Previously this fell to the
    # dormant tail (rank 8) and went unnoticed — the exact blind spot this ticket closes.
    if (
        record.get("call_site_count") == 0
        and status in ("active", "dormant")
        and (status == "dormant" or anomaly)
    ):
        return 2
    if anomaly and status == "active" and elevated:
        return 3
    if anomaly and status in ("active", "system", "code_unknown"):
        return 4
    if div.startswith("declared"):
        return 5
    if status == "dormant" and elevated:
        return 6
    if status == "instrumented_never_observed":
        return 7
    if status == "dormant":
        return 8
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
    code: Mapping[str, Mapping[str, Any]],
    watched_families: Iterable[str],
    watchlist_events: Iterable[str],
    today: date,
    window_days: int = PROPOSAL_WINDOW_DAYS,
    dismissed_events: Iterable[str] = (),
) -> list[dict]:
    """Self-healing watchlist: events worth adding to the curated list.

    A proposal is a catalog event that is in a watched family, first seen within the
    window, not already on the list, not system/auto-tracked, and **currently live** —
    firing in the last 30 days and not retired in code. The liveness gate is what keeps
    dead events out of the queue: dormant / retired-and-quiet events fire zero times so
    they fail the firing check, and orphaned-firing events (the retired old half of a
    rename, still trickling from old clients) are excluded by the code-retired check.
    Brand-new events that fire but are not in the provenance CSV yet still qualify.

    Returns ``[{event_type, family, first_seen_date}]`` newest-first — the proposal queue
    the runbook triages with a human before adding rows to ``monitored_events.yaml``.
    """
    watched_families = set(watched_families)
    watchlist_events = set(watchlist_events)
    dismissed_events = set(dismissed_events)
    cutoff = today - timedelta(days=window_days)
    out: list[dict] = []
    for row in catalog:
        event_type = row["event_type"]
        family = row["family"]
        if family not in watched_families or event_type in watchlist_events:
            continue
        if event_type in dismissed_events:
            continue  # human dismissed this proposal — never re-propose it (DATA-2152)
        if is_system(family, event_type):
            continue
        if int(row.get("event_count_30d") or 0) <= 0:
            continue  # not firing -> dormant / retired-and-quiet; do not propose a dead event
        crow = code.get(event_type)
        if crow and to_date(crow.get(RETIRED_COL)):
            continue  # retired in code -> orphaned-firing old half of a rename; do not propose
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
    dismissed_events: Iterable[str] = (),
) -> dict:
    """Reconcile the three axes into per-event records, status counts, a ranked flag list,
    and the self-healing watchlist proposal queue."""
    current_monday = today - timedelta(days=today.weekday())
    series = weekly_series(weekly_rows, current_monday)
    watchlist_events = set(watchlist_events)
    dismissed_events = set(dismissed_events)
    seen_in_catalog = {row["event_type"] for row in catalog}
    records: list[dict] = []

    for row in catalog:
        event_type = row["event_type"]
        family = row["family"]
        description = row["govern_description"]
        cnt30 = int(row["event_count_30d"] or 0)
        firing_recent = cnt30 > 0
        last_seen = to_date(row["last_seen_date"])
        crow = code.get(event_type)
        gpmeta = parse_gpmeta(description)
        anomaly = detect_anomaly(series.get(event_type, []))
        on_watchlist = event_type in watchlist_events
        cs_raw = (crow or {}).get(CALL_SITE_COUNT_COL)
        call_site_count = int(cs_raw) if cs_raw not in (None, "") else None

        if is_system(family, event_type):
            status = "system"  # anomaly-watched only
        else:
            in_code = None if crow is None else True
            retired = to_date(crow.get(RETIRED_COL)) if crow else None
            status = classify_status(
                in_code=in_code, firing_recent=firing_recent, retired_date=retired,
                last_seen_date=last_seen, today=today,
            )

        records.append(
            {
                "event_type": event_type,
                "family": family,
                "status": status,
                "elevated": is_elevated(family, event_type, description, on_watchlist=on_watchlist),
                "on_watchlist": on_watchlist,
                "event_count_30d": cnt30,
                "last_seen_date": last_seen,
                "anomaly": anomaly,
                "instrumented_pr": (crow or {}).get(INSTRUMENTED_PR_COL),
                "call_site_count": call_site_count,
                "call_site_retired_date": (crow or {}).get(CALL_SITE_RETIRED_COL) or None,
                "divergence": divergence(gpmeta, status, firing_recent, last_seen),
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
                    "call_site_count": (lambda v: int(v) if v not in (None, "") else None)(
                        crow.get(CALL_SITE_COUNT_COL)
                    ),
                    "call_site_retired_date": crow.get(CALL_SITE_RETIRED_COL) or None,
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

    proposals = propose_watchlist_additions(
        catalog, code, watched_families, watchlist_events, today,
        dismissed_events=dismissed_events,
    )

    # Stamp each record with the watchlist axis's verdict (DATA-2152): tracked (already
    # curated) beats dismissed (human rejected) beats proposed (self-healing candidate);
    # everything else is untouched by the watchlist.
    proposed_types = {p["event_type"] for p in proposals}
    for record in records:
        et = record["event_type"]
        if record["on_watchlist"]:
            record["watchlist_status"] = "tracked"
        elif et in dismissed_events:
            record["watchlist_status"] = "dismissed"
        elif et in proposed_types:
            record["watchlist_status"] = "proposed"
        else:
            record["watchlist_status"] = "—"

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

    Returns ``{"new", "resolved", "still_open", "escalated"}`` lists of event_types.
    ``escalated`` holds events flagged in both runs whose status changed (e.g. a dormant
    event that started firing) — these must surface, not hide in ``still_open``. ``prior``
    None (first run) -> everything is new.
    """
    current = {r["event_type"]: r["status"] for r in flagged}
    if prior is None:
        return {"new": sorted(current), "resolved": [], "still_open": [], "escalated": []}
    return {
        "new": sorted(e for e in current if e not in prior),
        "resolved": sorted(e for e in prior if e not in current),
        "still_open": sorted(e for e in current if e in prior and current[e] == prior[e]),
        "escalated": sorted(e for e in current if e in prior and current[e] != prior[e]),
    }


# --- rendering ----------------------------------------------------------------

_RANK_LABEL = {
    0: "counter blind spot: 0 call sites but firing normally (fix the counter, not the event)",
    1: "orphaned-firing / not-in-use still firing",
    2: "call site removed, name constant remains",
    3: "anomaly drop, active (elevated)",
    4: "anomaly drop, active",
    5: "intent divergence",
    6: "dormant (elevated)",
    7: "instrumented, never observed",
    8: "dormant",
}


def _evidence(record: Mapping[str, Any]) -> str:
    parts = [f"30d={record['event_count_30d']}"]
    if record["anomaly"]:
        parts.append(f"week {record['anomaly']['current']} vs base {record['anomaly']['baseline']}")
    if record["last_seen_date"]:
        parts.append(f"last_seen {record['last_seen_date']}")
    if record.get("call_site_count") == 0:
        removed = record.get("call_site_retired_date")
        parts.append(f"call_sites=0 (removed {removed})" if removed else "call_sites=0")
    if record["instrumented_pr"]:
        parts.append(f"PR {record['instrumented_pr']}")
    return "; ".join(parts)


# Rank-7 (plain dormant) events are listed as one compact line, not table rows: there are
# routinely dozens and they repeat every weekly section, so a full table would bury the
# priority flags above. Anything rank <= this threshold gets a detailed row.
PRIORITY_RANK_MAX = 7
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
        _changes_line("escalated", changes["escalated"]),
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


def load_watchlist(path: Path = WATCHLIST) -> tuple[list[str], list[str], list[str]]:
    """Read ``monitored_events.yaml`` -> ``(watched_families, watchlist_event_names,
    dismissed_event_names)``. ``dismissed`` are proposals a human rejected (DATA-2152);
    the proposal queue skips them permanently so a rejected event never re-proposes (the
    per-row ``date`` is an informational audit note, not a suppression expiry)."""
    if not path.exists():
        return [], [], []
    doc = yaml.safe_load(path.read_text()) or {}
    families = doc.get("watched_families", []) or []
    events = [row["event"] for row in (doc.get("events", []) or []) if row.get("event")]
    dismissed = [row["event"] for row in (doc.get("dismissed", []) or []) if row.get("event")]
    return families, events, dismissed


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


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file + rename so a crash mid-write can't leave a truncated
    state file that would brick every later run on JSONDecodeError."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def load_prior_state(path: Path | None) -> dict[str, str] | None:
    if not path or not path.exists():
        return None
    # Tolerate a corrupt/truncated state file: fall back to a clean rebuild rather than
    # crashing every run. A missing/non-dict ``flagged`` would make diff treat all as new.
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    flagged = data.get("flagged")
    return flagged if isinstance(flagged, dict) else None


def load_prior_anomalous(path: Path | None) -> set[str] | None:
    """Read the prior run's anomalous-event set from the state file (DATA-2057). Lets the
    Slack quiet gate tell a *newly* anomalous event from a persistent one. None when the
    file is absent/corrupt or predates this key (first Slack-aware run)."""
    if not path or not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    anomalous = data.get("anomalous")
    return set(anomalous) if isinstance(anomalous, list) else None


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
    watched_families, watchlist_events, dismissed_events = load_watchlist(watchlist_path)
    result = reconcile(
        catalog, weekly, code, today, watchlist_events, watched_families,
        dismissed_events=dismissed_events,
    )
    changes = diff_flagged(result["flagged"], load_prior_state(state_path))
    return result, changes


def _json_default(obj: Any) -> str:
    if isinstance(obj, date):
        return obj.isoformat()
    raise TypeError(f"not serializable: {type(obj)}")


def prepend_log(log_path: Path, section: str) -> None:
    """Insert the dated digest section above prior runs (newest first), below the header."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    existing = log_path.read_text() if log_path.exists() else ""
    match = re.search(r"^## \d{4}-\d{2}-\d{2}$", existing, re.MULTILINE)
    if match:
        log_path.write_text(existing[: match.start()] + section + "\n" + existing[match.start() :])
    else:
        log_path.write_text(existing + ("\n" if existing else "") + section)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analytics event health monitor (DATA-1952).")
    parser.add_argument("--csv", type=Path, default=CODE_CSV, help="provenance CSV (code axis)")
    parser.add_argument("--watchlist", type=Path, default=WATCHLIST, help="curated watchlist YAML")
    parser.add_argument("--json", type=Path, help="also write the full result JSON here")
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG, help="longitudinal log to write to")
    parser.add_argument("--no-log", action="store_true", help="do not write to the log")
    parser.add_argument(
        "--state",
        type=Path,
        default=DEFAULT_STATE,
        help="prior-run state JSON for the changes diff (default: instrumentation_data/)",
    )
    parser.add_argument(
        "--slack",
        action="store_true",
        help="post the delta-led health digest to Slack (Source B, DATA-2057). Reads "
        "SLACK_APP_BOT_TOKEN + SLACK_EVENT_LIFECYCLE_CHANNEL_ID; quiet when nothing changed. "
        "A Slack failure warns but never changes the exit code.",
    )
    parser.add_argument(
        "--gap-slack",
        type=Path,
        default=None,
        help="gap run-data JSON (from instrumentation_gaps.py --slack-out) to fold into the "
        "digest post as a two-part parent + threaded detail",
    )
    parser.add_argument(
        "--today",
        help="override the run date (YYYY-MM-DD); default = system date. Shifts only the "
        "local reconciliation (dormant window, week cutoff, run-date label). The firing axis "
        "is always live warehouse data (current_date(), event_count_30d), so this is a "
        "label / diff aid for same-day reruns, not a historical replay.",
    )
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
        prepend_log(args.log, section)
    if args.json:
        args.json.write_text(json.dumps(result, indent=2, default=_json_default) + "\n")

    # Source B (DATA-2057): post the digest BEFORE the state write below advances the diff.
    # `changes` was computed against the prior state; once _atomic_write runs, that prior is
    # gone, so a separate process would see an already-consumed diff. Re-read the prior state
    # here (cheap) only to render escalated events as prior -> current. Non-fatal: a Slack
    # error warns and never changes the exit code — the log/state write-back is the real work.
    if args.slack:
        import event_state_slack as slk

        token, channel = os.environ.get(slk.TOKEN_ENV), os.environ.get(slk.CHANNEL_ENV)
        if not token or not channel:
            print(
                f"--slack set but {slk.TOKEN_ENV}/{slk.CHANNEL_ENV} unset; skipping the Slack post.",
                file=sys.stderr,
            )
        else:
            gap = None
            if args.gap_slack:
                try:
                    loaded = json.loads(args.gap_slack.read_text())
                    gap = loaded if isinstance(loaded, dict) else None
                except (OSError, json.JSONDecodeError) as exc:
                    print(
                        f"--gap-slack {args.gap_slack} unreadable ({exc}); posting health only.",
                        file=sys.stderr,
                    )
            try:
                prior_state = load_prior_state(args.state)
                prior_anomalous = load_prior_anomalous(args.state)
                ts = slk.post_digest(result, changes, prior_state, token=token, channel=channel,
                                     prior_anomalous=prior_anomalous, gap=gap)
                print(f"slack: posted digest (ts {ts})" if ts else "slack: quiet (no change)", file=sys.stderr)
            except Exception as exc:  # noqa: BLE001 — never let Slack fail the monitor
                print(f"slack: post failed ({exc}); monitor run unaffected.", file=sys.stderr)

    if args.state:
        state = {
            "run_date": today.isoformat(),
            "flagged": {r["event_type"]: r["status"] for r in result["flagged"]},
            # anomalous set persisted for the Slack quiet gate (DATA-2057): distinguishes a
            # newly anomalous event from one that was already anomalous last run.
            "anomalous": sorted(r["event_type"] for r in result["flagged"] if r["anomaly"]),
        }
        _atomic_write(args.state, json.dumps(state, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
