"""Assemble the consumer-facing event-state table (DATA-2052, sub-ticket A).

Joins the Amplitude event catalog (Databricks), the git-provenance CSV, and the SOP status
derived by analytics_event_health.reconcile() into one ordered, output-agnostic list of row
dicts. The gSheet sink consumes build_rows()'s output; the status column is
byte-identical to the health monitor's because both go through reconcile()/classify_status().
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

import analytics_event_health as aeh
from databricks_query import execute_query

CATALOG_TABLE = "goodparty_data_catalog.dbt.int__amplitude_event_catalog"
EVENT_STATE_SQL = f"""
select event_type, govern_display_name, family, first_seen_date, last_seen_date,
       event_count, event_count_30d, govern_description, govern_tags
from {CATALOG_TABLE}
"""

# 18 columns, render order. See the design doc for the rationale behind the set.
COLUMNS = [
    "event",
    "status",
    "declared_intent",
    "intent_date",
    "supersession",
    "family",
    "first_seen_date",
    "last_seen_date",
    "event_count_30d",
    "event_count",
    "description",
    "tags",
    "instrumented_pr",
    "instrumented_date",
    "instrumented_author_email",
    "retired_pr",
    "retired_date",
    "retired_author_email",
]


def format_tags(value: Any) -> str:
    """govern_tags is array<string> in the catalog (returned as a numpy ndarray by the
    Databricks connector). Render as a comma list; blank for null/empty."""
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    if isinstance(value, str):
        return value
    try:
        items = list(value)
    except TypeError:
        return str(value)
    return ", ".join(str(v) for v in items if str(v))


def _blank(value: Any) -> Any:
    return "" if value is None else value


def _num(value: Any) -> Any:
    if value is None:
        return 0
    if isinstance(value, float) and math.isnan(value):
        return 0
    return value


def build_rows(
    records: Sequence[Mapping[str, Any]],
    catalog_by_type: Mapping[str, Mapping[str, Any]],
    code_map: Mapping[str, Mapping[str, Any]],
) -> list[dict]:
    """Project reconcile records + catalog + provenance into COLUMNS rows, most-recently
    touched-in-code first (rows with no provenance date sort last; 30d volume breaks ties)."""
    rows: list[dict] = []
    for rec in records:
        event_type = rec["event_type"]
        cat = catalog_by_type.get(event_type, {})
        prov = code_map.get(event_type, {})
        gpmeta = rec.get("gpmeta") or {}
        supersession = (gpmeta.get("supersession") or "").strip()
        if supersession.lower() == "original":
            supersession = ""
        rows.append(
            {
                "event": cat.get("govern_display_name") or event_type,
                "status": rec["status"],
                "declared_intent": {"in_use": "in use", "not_in_use": "not in use"}.get(
                    gpmeta.get("intent"), ""
                ),
                "intent_date": _blank(gpmeta.get("intent_date")),
                "supersession": supersession,
                "family": _blank(rec.get("family") or cat.get("family")),
                "first_seen_date": _blank(cat.get("first_seen_date")),
                "last_seen_date": _blank(cat.get("last_seen_date")),
                "event_count_30d": _num(cat.get("event_count_30d", rec.get("event_count_30d", 0))),
                "event_count": _num(cat.get("event_count", 0)),
                "description": _blank(gpmeta.get("purpose")),
                "tags": format_tags(cat.get("govern_tags")),
                "instrumented_pr": _blank(prov.get("instrumented_pr")),
                "instrumented_date": _blank(prov.get("instrumented_date")),
                "instrumented_author_email": _blank(prov.get("instrumented_author_email")),
                "retired_pr": _blank(prov.get("retired_pr")),
                "retired_date": _blank(prov.get("retired_date")),
                "retired_author_email": _blank(prov.get("retired_author_email")),
                "_sort_date": prov.get("last_code_change_date") or "",
            }
        )
    rows.sort(key=lambda r: (r["_sort_date"], r["event_count_30d"]), reverse=True)
    for row in rows:
        row.pop("_sort_date", None)
    return rows


# Fields reconcile() reads by direct subscript; an injected catalog row must carry them all.
_INJECT_SKELETON = {
    "family": None,
    "govern_display_name": None,
    "govern_description": None,
    "govern_tags": None,
    "first_seen_date": None,
    "last_seen_date": None,
    "event_count": None,
    "event_count_30d": None,
}
_OVERRIDE_FIELDS = ("govern_display_name", "govern_description", "govern_tags")


def _apply_overrides(
    catalog: list[dict],
    overrides: Mapping[str, Mapping[str, Any]] | None,
) -> list[dict]:
    """Replace-or-inject catalog rows from an Amplitude-direct override (DATA-2053), keyed on
    event_type, so an event-driven refresh reflects govern_* metadata written to Amplitude
    before the daily Databricks catalog sync. Only the three govern_* fields are overridden;
    status, provenance, and volume still come from their own sources. A missing event is
    injected with the full skeleton reconcile() requires (a zero-volume brand-new event then
    classifies as dormant when it also has a provenance-CSV row; absent both catalog and CSV
    it is ``code_unknown``)."""
    if not overrides:
        return catalog
    by_type = {row["event_type"]: row for row in catalog}
    for event_type, fields in overrides.items():
        row = by_type.get(event_type)
        if row is None:
            row = {"event_type": event_type, **_INJECT_SKELETON}
            catalog.append(row)
            by_type[event_type] = row
        for key in _OVERRIDE_FIELDS:
            if key in fields:
                row[key] = fields[key]
    return catalog


def fetch_catalog(run_query=execute_query) -> list[dict]:
    """Run the wider catalog query and return list-of-dict rows."""
    return run_query(EVENT_STATE_SQL).to_dict("records")


def assemble(
    today: date,
    *,
    run_query=execute_query,
    code_csv: Path | None = None,
    overrides: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict:
    """Load the catalog + provenance, derive status via the shared reconcile(), and project
    into the 18-column table. weekly_rows=[] skips the monitor's anomaly query — irrelevant
    to this surface — while still yielding the authoritative status for every event.
    ``overrides`` maps event_type -> {govern_*} to overlay Amplitude-direct metadata onto
    (or inject rows into) the Databricks catalog (DATA-2053)."""
    catalog = fetch_catalog(run_query)
    catalog = _apply_overrides(catalog, overrides)
    code_map = aeh.load_code_axis(code_csv) if code_csv else aeh.load_code_axis()
    reconciled = aeh.reconcile(catalog, weekly_rows=[], code=code_map, today=today)
    catalog_by_type = {row["event_type"]: row for row in catalog}
    rows = build_rows(reconciled["records"], catalog_by_type, code_map)
    return {
        "rows": rows,
        "meta": {
            "refreshed_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "event_count": len(rows),
            "provenance_path": str(code_csv or aeh.CODE_CSV),
        },
    }
