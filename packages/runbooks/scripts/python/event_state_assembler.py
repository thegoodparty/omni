"""Assemble the consumer-facing event-state table (DATA-2052, sub-ticket A).

Joins the Amplitude event catalog (Databricks), the git-provenance CSV, and the SOP status
derived by analytics_event_health.reconcile() into one ordered, output-agnostic list of row
dicts. The ClickUp / gSheet sinks consume build_rows()'s output; the status column is
byte-identical to the health monitor's because both go through reconcile()/classify_status().
"""

from __future__ import annotations

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

# 16 columns, render order. See the design doc for the rationale behind the set.
COLUMNS = [
    "event",
    "status",
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
    """govern_tags is array<string> in the catalog; render as a comma list. Blank for null."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value)
    return str(value)


def _blank(value: Any) -> Any:
    return "" if value is None else value


def _num(value: Any) -> Any:
    return 0 if value is None else value


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


def fetch_catalog(run_query=execute_query) -> list[dict]:
    """Run the wider catalog query and return list-of-dict rows."""
    return run_query(EVENT_STATE_SQL).to_dict("records")


def assemble(
    today: date,
    *,
    run_query=execute_query,
    code_csv: Path | None = None,
) -> dict:
    """Load the catalog + provenance, derive status via the shared reconcile(), and project
    into the 16-column table. weekly_rows=[] skips the monitor's anomaly query — irrelevant
    to this surface — while still yielding the authoritative status for every event."""
    catalog = fetch_catalog(run_query)
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
