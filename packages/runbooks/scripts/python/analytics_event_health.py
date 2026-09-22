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

import sem_anchors

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


def _sql_quote(value: str) -> str:
    """Single-quoted SQL literal with embedded quotes doubled. Event names are declared
    upstream in the semantic layer, not user input, but an apostrophe in a declared name
    would silently corrupt the predicate — the same class of bug as DATA-2427."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def build_path_weekly_sql(legs: Sequence[Any]) -> str:
    """Weekly counts for path-qualified legs, or "" when there are none.

    A separate query from WEEKLY_SQL because the site-wide page event is 4.46M rows and
    only its '/dashboard' slice is the instrument; grouping the whole event would drown
    the signal it exists to watch.
    """
    pathed = [leg for leg in legs if leg.path]
    if not pathed:
        return ""
    predicates = " or ".join(
        f"(event_type = {_sql_quote(leg.event)} "
        f"and event_properties:path::string = {_sql_quote(leg.path)})"
        for leg in pathed
    )
    return f"""
select event_type,
       event_properties:path::string as page_path,
       date_trunc('week', cast(event_time as date)) as week_start,
       count(*) as n
from {STREAM_TABLE}
where cast(event_time as date) >= date_sub(current_date(), 63)
  and ({predicates})
group by event_type, event_properties:path::string,
         date_trunc('week', cast(event_time as date))
"""


def key_path_rows(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Rewrite path-qualified rows onto their leg key so they flow through
    ``weekly_series`` and ``detect_anomaly`` with no special-casing downstream."""
    return [
        {
            "event_type": sem_anchors.Leg(row["event_type"], row["page_path"]).key,
            "week_start": row["week_start"],
            "n": row["n"],
        }
        for row in rows
    ]


def fetch_path_weekly(run_query: Callable[[str], Any], legs: Sequence[Any]) -> list[dict]:
    sql = build_path_weekly_sql(legs)
    if not sql:
        return []
    return key_path_rows(_records_from_df(run_query(sql)))


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


def _prose(text: str) -> str | None:
    """Collapse a run of description prose to one line; None when it holds no words.

    Truncates at the first ``<!--`` so a malformed/unclosed gp-meta marker (or a second,
    duplicate block) never leaks its raw markup into the purpose — worst case degrades to
    the pre-DATA-2426 blank cell, not a garbled one.
    """
    return " ".join(text.split("<!--", 1)[0].split()) or None


def _strip_sep(value: str) -> str:
    """Drop the trailing ' |' gp-meta line separator from a field value."""
    return value.rstrip().removesuffix("|").rstrip()


def parse_gpmeta(description: str | None) -> dict | None:
    """Parse the ``<!-- gp-meta -->`` block from a Govern description.

    Returns ``{"intent": "in_use"|"not_in_use"|None, "intent_date": str|None,
    "supersession": str|None, "purpose": str|None, "fires_on": str|None, "url": str|None}``
    (``intent_date`` is the YYYY-MM-DD on the in-use / not-in-use status line), or ``None``
    only when there is no description at all. A description with no block still yields a
    record whose ``purpose`` is the prose itself: most events pre-date the block, and
    dropping their description on the floor is what left the sheet's description column
    reading half-empty (DATA-2426).
    """
    if not description or not description.strip():
        return None
    match = GPMETA.search(description)
    if not match:
        return {
            "intent": None,
            "intent_date": None,
            "supersession": None,
            "purpose": _prose(description),
            "fires_on": None,
            "url": None,
        }
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
    sup = re.search(r"^\s*supersession\s*:\s*(.+)$", block, re.IGNORECASE | re.MULTILINE)
    fires_on = re.search(r"^\s*fires_on\s*:\s*(.+)$", block, re.IGNORECASE | re.MULTILINE)
    url = re.search(r"^\s*url\s*:\s*(.+)$", block, re.IGNORECASE | re.MULTILINE)
    # Purpose: the first content line that is neither a known field nor an in/out-of-use
    # status line. Trailing " |" (the gp-meta line separator) is stripped.
    purpose = None
    for raw in block.splitlines():
        line = raw.strip()
        if not line:
            continue
        if re.match(r"^(supersession|in use|not in use|change-set)\b", line, re.IGNORECASE):
            continue
        if re.match(r"^(fires_on|url)\s*:", line, re.IGNORECASE):
            continue
        purpose = line.rstrip().removesuffix("|").rstrip()
        break
    if purpose is None:
        purpose = _prose(description[: match.start()] + " " + description[match.end() :])
    return {
        "intent": intent,
        "intent_date": intent_date,
        "supersession": _strip_sep(sup.group(1)) if sup else None,
        "purpose": purpose,
        "fires_on": _strip_sep(fires_on.group(1)) if fires_on else None,
        "url": _strip_sep(url.group(1)) if url else None,
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


def call_site_removal_straddles_window(record: Mapping[str, Any]) -> bool:
    """True when a zero call-site count reflects a removal INSIDE the 30-day window.

    The rank-0 canary reads "firing with zero call sites" as a blind counter, on the premise
    that a client event cannot fire while nothing calls it. A window straddling the removal
    breaks that premise: the traffic is all pre-removal, so the zero is a genuine retirement
    (DATA-2427). Same trap DATA-2140 fixed for ``orphaned_firing``, one column over.

    A missing removal date means nothing to straddle, and a missing ``last_seen`` (Databricks
    catalog gap) is ambiguous -- both fall back to False so a real blind spot is never hidden
    behind a null date.
    """
    removed = to_date(record.get("call_site_retired_date"))
    last_seen = to_date(record.get("last_seen_date"))
    if removed is None or last_seen is None:
        return False
    return last_seen <= removed + timedelta(days=ORPHAN_GRACE_DAYS)


def rank_record(record: Mapping[str, Any]) -> int:
    """Digest severity rank (0 = highest). 99 = not flagged."""
    status, elevated, anomaly = record["status"], record["elevated"], record["anomaly"]
    div = record["divergence"] or ""
    # DATA-2421: a latched break on an OKR-anchored instrument outranks every other
    # signal, including the counter canary. The canary means "the tooling is blind";
    # this means "a number the company steers by is wrong right now".
    if record.get("latched"):
        return 0
    # DATA-2106 canary: a client event firing normally (active, no anomaly) with zero counted
    # call sites is a contradiction -- the data axis says alive, the code axis says gone. The
    # counter is blind (an aliased or Prettier-wrapped reference it cannot see), not the
    # event dead: a tooling alert, never the rank-2 retirement path. An anomaly drop
    # alongside the zero is instead the signature of a genuine recent removal (counts
    # draining after the call site went away) and falls through to rank 2 below.
    if (
        record.get("call_site_count") == 0
        and status == "active"
        and not anomaly
        and not call_site_removal_straddles_window(record)
    ):
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
        and (status == "dormant" or anomaly or call_site_removal_straddles_window(record))
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
    okr_by_event: Mapping[str, str] | None = None,
) -> dict:
    """Reconcile the three axes into per-event records, status counts, a ranked flag list,
    and the self-healing watchlist proposal queue."""
    current_monday = today - timedelta(days=today.weekday())
    series = weekly_series(weekly_rows, current_monday)
    watchlist_events = set(watchlist_events)
    dismissed_events = set(dismissed_events)
    okr_by_event = dict(okr_by_event or {})
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
                "okr": okr_by_event.get(event_type),
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
                    "okr": okr_by_event.get(event_type),
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

# Rank 0 carries two unrelated findings, so the two wordings live apart and the digest
# picks between them per record (``_record_rank_label``). The dict entry stays the rank's
# own summary, for anything reading the rank rather than a record.
_LATCHED_LABEL = "OKR anchor dormant (latched)"
_CANARY_LABEL = (
    "counter blind spot: 0 call sites but firing normally (fix the counter, not the event)"
)

_RANK_LABEL = {
    0: f"{_LATCHED_LABEL} / counter blind spot",
    1: "orphaned-firing / not-in-use still firing",
    2: "call site removed, name constant remains",
    3: "anomaly drop, active (elevated)",
    4: "anomaly drop, active",
    5: "intent divergence",
    6: "dormant (elevated)",
    7: "instrumented, never observed",
    8: "dormant",
}


def _record_rank_label(record: Mapping[str, Any]) -> str:
    """The rank's label narrowed to the condition this record actually hit.

    Only rank 0 needs narrowing: a latched OKR anchor and the DATA-2106 counter blind
    spot share it, and it is the row a reader acts on first. Rendering the shared label
    there tells someone a number the company steers by is dormant when the finding is a
    tooling alert, which is the credibility the digest cannot afford to spend.
    """
    if record.get("latched"):
        return _LATCHED_LABEL
    if record["rank"] == 0:
        return _CANARY_LABEL
    return _RANK_LABEL.get(record["rank"], "")


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
    ]
    latched = {k: v for k, v in (result.get("latches") or {}).items() if v.get("latched")}
    if latched:
        lines.append("")
        lines.append("### OKR anchors dormant (latched)")
        lines.append("")
        lines.append("| instrument | metric | broken since | pre-break level |")
        lines.append("| --- | --- | --- | --- |")
        for key, rec in sorted(latched.items()):
            # Read defensively: a hand-edited state file can drop a field, and okr_latch
            # carries such a record through rather than crashing. A renderer that then
            # raises would take the whole digest down over the corruption it was built
            # to survive.
            lines.append(
                f"| {key} | {rec.get('metric', '?')} | {rec.get('since', '?')} | "
                f"{rec.get('reference', '?')} /wk |"
            )
        lines.append("")
        lines.append(
            "Clears on recovery, or when the metric's `anchored_on` changes in the "
            "semantic layer. There is no dismiss path."
        )
    # The guard disabling itself must be as loud as the thing it guards against.
    for problem in result.get("anchor_problems") or []:
        lines.append("")
        lines.append(f"> **OKR dormancy checks degraded.** {problem}")
    tag_problems = result.get("okr_tag_problems") or []
    if tag_problems:
        lines.append("")
        lines.append("### OKR tags the semantic layer does not back")
        lines.append("")
        for problem in tag_problems:
            lines.append(f"- {problem}")
    lines.append("")
    lines.append("### Flagged (ranked)")
    lines.append("")
    lines.append("| rank | event | status | elev | evidence | divergence |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for r in priority:
        elev = "yes" if r["elevated"] else ""
        lines.append(
            f"| {r['rank']} {_record_rank_label(r)} | {r['event_type']} | "
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


def _render_okr(okr: Any) -> str:
    """List values render as one comma-joined display string."""
    return ", ".join(str(v) for v in okr) if isinstance(okr, list) else str(okr)


def load_watchlist(
    path: Path = WATCHLIST,
) -> tuple[list[str], list[str], list[str], dict[str, str]]:
    """Read ``monitored_events.yaml`` -> ``(watched_families, watchlist_event_names,
    dismissed_event_names, okr_by_event)``. ``dismissed`` are proposals a human rejected
    (DATA-2152); the proposal queue skips them permanently. ``okr_by_event`` (DATA-2174)
    maps watchlist events to the OKR metric(s) anchored on them — the digest's top-tier
    signal; list values render as one comma-joined display string."""
    if not path.exists():
        return [], [], [], {}
    doc = yaml.safe_load(path.read_text()) or {}
    families = doc.get("watched_families", []) or []
    rows = [row for row in (doc.get("events", []) or []) if row.get("event")]
    events = [row["event"] for row in rows]
    dismissed = [row["event"] for row in (doc.get("dismissed", []) or []) if row.get("event")]
    okr_by_event = {row["event"]: _render_okr(row["okr"]) for row in rows if row.get("okr")}
    return families, events, dismissed, okr_by_event


def load_monitored_events(
    path: Path = WATCHLIST,
) -> tuple[list[str], list[str], list[str], dict[str, str]]:
    """The monitor's view of the file: ``load_watchlist`` widened with every event a
    behavior declares as an instrument (DATA-2290).

    Behaviors are the successor surface (DATA-2316) and rule 8 forces an event off
    ``events:`` the moment it migrates, so a monitor reading only ``events:`` goes blind to
    exactly the events the registry cares most about. ``load_watchlist`` stays the literal
    reader because ``behavior_registry`` feeds it straight into that rule; widening it in
    place would make rule 8 fire on every behavior in the file. A behavior's ``okr:``
    anchors each of its instruments; an authored ``events:`` row wins any collision.
    """
    families, events, dismissed, okr_by_event = load_watchlist(path)
    if not path.exists():
        return families, events, dismissed, okr_by_event
    doc = yaml.safe_load(path.read_text()) or {}
    for behavior in doc.get("behaviors", []) or []:
        okr = _render_okr(behavior["okr"]) if behavior.get("okr") else None
        for surface in behavior.get("surfaces", []) or []:
            name = surface.get("instrumented_by")
            if not name:
                continue  # explicit null = a declared gap, nothing to monitor yet
            if name not in events:
                events.append(name)
            if okr:
                okr_by_event.setdefault(name, okr)
    return families, events, dismissed, okr_by_event


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


def load_prior_latches(path: Path | None) -> dict[str, dict]:
    """Prior run's latch records (DATA-2421). ``{}`` when absent or corrupt: a lost latch
    re-arms on the next broken week rather than crashing the run."""
    if not path or not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    latches = data.get("latches")
    return latches if isinstance(latches, dict) else {}


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


# Status carried by a latched anchor leg the catalog has no row for. A path-qualified
# slice of an event is an instrument in its own right, but not something Amplitude counts
# as an event, so none of the SOP statuses fit it.
LATCHED_STATUS = "okr_anchor_dormant"


def _latched_leg_record(
    key: str, latch: Mapping[str, Any], weeks: Sequence[tuple[date, int]], today: date
) -> dict:
    """A flagged row for a latched leg that ``reconcile`` never built a record for.

    ``reconcile`` builds records from the catalog, so a path-qualified leg
    (``Viewed[path=/dashboard]``) has none — and a latch that reaches no consumer is the
    same silent failure this ticket exists to remove. The shape mirrors a reconcile record
    key for key so the digest table, ``digest_triage`` and the state diff need no special
    case for it.
    """
    cutoff = today - timedelta(days=DORMANT_DAYS)
    record = {
        "event_type": key,
        "family": None,
        "status": LATCHED_STATUS,
        # An OKR anchor is elevated by definition; nothing else about this leg is known.
        "elevated": True,
        "on_watchlist": False,
        "okr": latch["metric"],
        # The catalog counts whole events, so the leg's own weekly rows are the only
        # honest source for the digest's count column.
        "event_count_30d": sum(n for week_start, n in weeks if week_start >= cutoff),
        "last_seen_date": None,
        "anomaly": None,
        "instrumented_pr": None,
        "call_site_count": None,
        "call_site_retired_date": None,
        "divergence": None,
        "gpmeta": None,
        "has_description": None,
        "watchlist_status": "—",
        "latched": True,
    }
    record["rank"] = rank_record(record)
    return record


def validate_okr_tags(
    okr_by_event: Mapping[str, str],
    anchors: Mapping[str, Sequence[Any]],
) -> list[str]:
    """Report `okr:` tags in monitored_events.yaml that the semantic layer does not back.

    The tag is a local convenience copy; the declaration is the kernel. Two problem
    classes, both worth saying out loud every run:

    1. Unknown — the tagged event appears in no metric's anchored_on at all. This is
       how the era-2 break went unescalated for a month: a tag pointing at a retired
       event name.
    2. Stale-to-historical — the tagged event is not live anywhere, but is declared as
       an ``era: historical`` leg on a metric that still has a live leg elsewhere. The
       instrument moved; the tag did not follow it. Reported with a softer message that
       names the live leg(s) to point the tag at instead.

    A tag whose event is historical on one metric but live on another is backed by a
    live declaration and is not reported. Nor is a tag on a historical leg of a metric
    whose every leg is historical — that metric has nowhere for the tag to move to, and
    run_monitor's own anchor_problems check already reports the metric itself; reporting
    the tag too would be duplicate noise under a different heading.

    An empty ``anchors`` means the cross-repo read did not happen (no token, GitHub
    down). Validating against nothing would report every tag as broken, so return
    nothing instead.
    """
    if not anchors:
        return []

    all_events = {leg.event for legs in anchors.values() for leg in legs}
    live_events = {leg.event for legs in anchors.values() for leg in legs if leg.watched}

    # event -> live leg keys of every metric where the event is a historical leg AND
    # that metric still has a live leg for the tag to move to.
    stale_targets: dict[str, list[str]] = {}
    for legs in anchors.values():
        live_keys = [leg.key for leg in legs if leg.watched]
        if not live_keys:
            continue
        for leg in legs:
            if not leg.watched:
                stale_targets.setdefault(leg.event, []).extend(live_keys)

    problems = []
    for event, metric in sorted(okr_by_event.items()):
        if event in live_events:
            continue
        if event not in all_events:
            problems.append(
                f"okr: tag on '{event}' ({metric}) — no governed metric declares this event in "
                f"anchored_on. Either the instrument moved and the semantic layer needs "
                f"updating, or the tag is stale."
            )
        elif event in stale_targets:
            targets = ", ".join(sorted(set(stale_targets[event])))
            problems.append(
                f"okr: tag on '{event}' ({metric}) — the semantic layer has moved this "
                f"instrument on; that event is now historical. Point the tag at "
                f"{targets} instead."
            )
    return problems


def run_monitor(
    run_query: Callable[[str], Any],
    *,
    today: date,
    csv_path: Path = CODE_CSV,
    watchlist_path: Path = WATCHLIST,
    state_path: Path | None = None,
    anchors: Mapping[str, Sequence[Any]] | None = None,
) -> tuple[dict, dict[str, list[str]]]:
    """Orchestrate a full pass: fetch the queries, read the code axis + watchlist +
    semantic-layer anchors, reconcile, latch, diff.

    ``anchors`` defaults to a live read; pass a dict in tests. An empty mapping (no
    token, or GitHub unreachable) disables the anchored checks and leaves every other
    check working, which is why the whole monitor does not hinge on a cross-repo read.
    """
    import okr_latch as ol  # local: okr_latch imports this module's constants

    read_problems: list[str] = []
    if anchors is None:
        anchors, read_problems = sem_anchors.load_anchors()

    # A metric that declares anchored_on but whose every leg is historical has no live
    # instrument left to watch. That is this ticket's disease in its purest form — the
    # metric still reports a number, and nothing is checking that anything still feeds
    # it — so it is reported even though the read itself succeeded.
    anchor_problems = read_problems + [
        f"'{metric}' declares anchored_on but every leg is historical, so no live "
        "instrument is being watched for it. Either the metric is retired, or its "
        "current instrument was never declared."
        for metric, legs in sorted(anchors.items())
        if legs and not any(leg.watched for leg in legs)
    ]

    watched_legs = [leg for legs in anchors.values() for leg in legs if leg.watched]
    # Last-wins if two governed metrics ever anchor the same leg key — no overlap in the
    # real declaration today, so this is latent. Not handled: an ambiguity here is a
    # semantic-layer authoring problem to fix at the source, not something to paper over.
    watched_by_key = {
        leg.key: metric
        for metric, legs in anchors.items()
        for leg in legs
        if leg.watched
    }

    catalog = fetch_catalog(run_query)
    weekly = fetch_weekly(run_query) + fetch_path_weekly(run_query, watched_legs)
    code = load_code_axis(csv_path)
    watched_families, watchlist_events, dismissed_events, local_okr_tags = (
        load_monitored_events(watchlist_path)
    )
    # A leg's metric name is authoritative over any hand-typed okr: tag for the same
    # event, because the semantic layer is the kernel and the tag is a local copy.
    okr_for_digest = {**local_okr_tags, **watched_by_key}

    result = reconcile(
        catalog, weekly, code, today, watchlist_events, watched_families,
        dismissed_events=dismissed_events, okr_by_event=okr_for_digest,
    )
    # Against local_okr_tags, not okr_for_digest: the merged map also carries
    # watched_by_key's entries, and those are keyed by LEG KEY, not event name — a path
    # leg's key is a synthetic string like "Viewed[path=/dashboard]" that no leg's
    # `.event` ever equals. Validating the merged map would spuriously fire Class 1
    # ("unknown event") on that synthetic key.
    result["okr_tag_problems"] = validate_okr_tags(local_okr_tags, anchors)

    current_monday = today - timedelta(days=today.weekday())
    # The WHOLE warehouse series, never a watched-only slice: update_latches tells a leg
    # going silent from the warehouse not having loaded that week by looking at the other
    # events' rows, and a filtered mapping would silently revert this ticket's fix.
    series = weekly_series(weekly, current_monday)
    prior_latches = load_prior_latches(state_path)
    latches = ol.update_latches(prior_latches, series, watched_by_key, today)
    # Keyed on read_problems, not on the per-metric all-historical entries in
    # anchor_problems: a metric going fully historical is an unambiguous governed
    # declaration change, one of the two sanctioned ways a latch clears, so THAT must
    # not hold the clear open. read_problems itself is not pure read failure — it also
    # carries "every sem file read fine but declared nothing anywhere", which IS
    # declaration content, held open here because an empty result can't be told apart
    # from the declaration not having landed yet.
    if read_problems:
        # A failed anchor read is not a de-declaration. update_latches drops every key it
        # cannot see in `watched`, and the state write below is the only place a sticky
        # reference lives — so one unreadable run would erase references that cannot be
        # re-derived once the break has aged into the baseline. That is this ticket's own
        # bug, rebuilt inside the degradation path. Hold what we can no longer check.
        latches = {
            **{k: v for k, v in prior_latches.items()
               if k not in watched_by_key and isinstance(v, Mapping) and v.get("metric")},
            **latches,
        }
    result["latches"] = latches
    result["anchor_problems"] = anchor_problems

    # Walk `records`, not `flagged`: a latched break is by construction one whose
    # detect_anomaly has gone quiet, so its record already ranks 99 and has dropped out of
    # `flagged` — and `flagged` is the only list digest_triage and the Slack quiet gate
    # read. Marking the flagged list alone would leave the latch visible in the markdown
    # log and invisible on the surface people actually read.
    by_event = {r["event_type"]: r for r in result["records"]}
    already_flagged = {id(r) for r in result["flagged"]}
    for key, latch in latches.items():
        if not latch.get("latched"):
            continue
        record = by_event.get(key)
        if record is None:
            # Deliberately appended to `flagged` only: a path leg is not a catalog event,
            # so adding it to `records` would corrupt total_events and status_counts.
            result["flagged"].append(
                _latched_leg_record(key, latch, series.get(key, ()), today)
            )
            continue
        record["latched"] = True
        record["okr"] = latch["metric"]
        record["rank"] = rank_record(record)
        if id(record) not in already_flagged:
            result["flagged"].append(record)
    result["flagged"].sort(key=lambda r: (r["rank"], -r["event_count_30d"]))

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


def build_slack_triage(
    result: Mapping[str, Any],
    changes: Mapping[str, list[str]],
    state_path: Path | None,
    gap: dict | None,
) -> dict | None:
    """Assemble + judge the digest triage (DATA-2174). None when the quiet gate would
    suppress the post anyway. Judged first, gated second, so the gate's red_open reads
    final tiers and can never suppress a judge-promoted red; quiet runs still skip the
    API call because their item list is empty (run_triage's no-items early return).
    Judge failure inside run_triage degrades to the rules tier, never raises."""
    import digest_triage as dt
    import event_state_slack as slk

    prior_anomalous = load_prior_anomalous(state_path)
    items = dt.build_items(
        result, changes,
        prior_state=load_prior_state(state_path),
        prior_anomalous=prior_anomalous,
    )
    triage = dt.run_triage(items, api_key=os.environ.get("ANTHROPIC_API_KEY"))
    # An expired token is the single most likely way the OKR dormancy checks stop
    # working, and it produces no other symptom, so it posts as red rather than as a
    # quiet line in the markdown log. Added AFTER run_triage, not before: run_triage
    # overwrites headline and action on every item it is handed, and this text is
    # run-level and authored here, so it is not the judge's to rewrite.
    # Spliced as a block rather than inserted one at a time, which would reverse them.
    triage["items"][:0] = [
        {
            "id": "(OKR dormancy checks)",
            "event_type": "(OKR dormancy checks)",
            "rank": 0, "okr": "run-level",
            "rules_tier": "red", "tier": "red",
            "headline": problem,
            # Generic because anchor_problems now covers five causes — a missing
            # token, a network/read failure, a sem file that will not parse, every
            # sem file reading fine but declaring nothing anywhere, and a metric with
            # no live leg — and each problem string already names its own.
            "action": ("Check GP_DATA_PLATFORM_READ_TOKEN and the sem files in "
                       "gp-data-platform, then re-run."),
        }
        for problem in result.get("anchor_problems") or []
    ]
    # Same reasoning, added after run_triage for the same reason: a stale okr: tag is
    # slow-moving governance drift, not a broken pipe, so it goes in yellow (never red,
    # and it must never flip red_open below) — forcing a post every week on a persistent
    # tag mismatch is the alert-fatigue pattern this project's digest explicitly avoids.
    # Appended rather than prepended: anchor_problems are run-level incidents that belong
    # at the top, tag problems are secondary detail.
    triage["items"].extend([
        {
            "id": "(okr tag check)",
            "event_type": "(okr tag check)",
            "rank": 5, "okr": "run-level",
            "rules_tier": "yellow", "tier": "yellow",
            "headline": problem,
            "action": ("Point the okr: tag in monitored_events.yaml at the event(s) the "
                       "semantic layer currently anchors, or remove it if the metric "
                       "itself is retired."),
        }
        for problem in result.get("okr_tag_problems") or []
    ])
    red_open = any(i.get("tier") == "red" for i in triage.get("items") or [])
    if not slk.should_post(result, changes, prior_anomalous, gap, red_open=red_open):
        return None
    return triage


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analytics event health monitor (DATA-1952).")
    parser.add_argument("--csv", type=Path, default=CODE_CSV, help="provenance CSV (code axis)")
    parser.add_argument("--watchlist", type=Path, default=WATCHLIST, help="curated watchlist YAML")
    parser.add_argument("--json", type=Path, help="also write the full result JSON here")
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG, help="longitudinal log to write to")
    parser.add_argument(
        "--no-log",
        action="store_true",
        help="print the digest only: write neither the log nor the state file, so a "
        "local run leaves the git-tracked instrumentation_data/ files untouched",
    )
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
                triage = build_slack_triage(result, changes, args.state, gap)
                ts = slk.post_digest(result, changes, prior_state, token=token, channel=channel,
                                     prior_anomalous=prior_anomalous, gap=gap, triage=triage)
                print(f"slack: posted digest (ts {ts})" if ts else "slack: quiet (no change)", file=sys.stderr)
            except Exception as exc:  # noqa: BLE001 — never let Slack fail the monitor
                print(f"slack: post failed ({exc}); monitor run unaffected.", file=sys.stderr)

    # Gated on --no-log as well as --state: the state file is git-tracked and authored by
    # the scheduled run, so a local ad-hoc run rewriting it dirties a shared checkout with
    # a diff that has to be reverted by hand. --no-log means "leave nothing behind"; the
    # scheduled workflow never passes it, so the cron still advances the diff and still
    # persists the latches' sticky references.
    if args.state and not args.no_log:
        state = {
            "run_date": today.isoformat(),
            "flagged": {r["event_type"]: r["status"] for r in result["flagged"]},
            # anomalous set persisted for the Slack quiet gate (DATA-2057): distinguishes a
            # newly anomalous event from one that was already anomalous last run.
            "anomalous": sorted(r["event_type"] for r in result["flagged"] if r["anomaly"]),
            # DATA-2421: the latch's sticky reference and "broken since" only survive
            # across runs here — losing them re-derives a reference from the already
            # broken weeks, which is the drift the latch exists to prevent.
            "latches": result.get("latches") or {},
        }
        # default=_json_default like the --json write: the latch records are authored by
        # okr_latch, and this file is the only place the sticky reference survives, so a
        # date sneaking into one must not fail the write that preserves it.
        _atomic_write(
            args.state, json.dumps(state, indent=2, default=_json_default) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
