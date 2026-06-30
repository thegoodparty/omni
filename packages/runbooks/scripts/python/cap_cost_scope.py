#!/usr/bin/env python3
"""Stage 1 — scope resolver: turn a plain-English / filter request into a concrete
set of CAP experiment_run rows to analyze.

POPULATION, NEVER SAMPLE. This resolver returns EVERY run in scope and prints the
count + UTC window so the operator can confirm before any S3 pull. Downstream
stages then cover all resolved runs and report coverage (logs parsed / runs in
scope).

Canonical cost is the DB column experiment_run.costUsd — invoice-validated (see
the module's SKILL.md). This resolver carries costUsd through so later stages
never re-derive dollars from token counts.

Supported scopes:
  --type meeting_briefing --since 2026-06-22      all runs of a type since a date
  --type meeting_briefing --on 2026-06-22         all runs of a type on a UTC day
  --type meeting_briefing --last-cohorts 3        last N dispatch-window cohorts
  --run-ids r1,r2,r3                              explicit ids
  --run-ids-file ids.csv                          one id per line (or a csv w/ run_id col)

"Cohort" = a burst of dispatches clustered in time. We cluster createdAt with a
gap threshold (default 2h): a gap larger than that starts a new cohort. This
matches how the bulk-* skills dispatch (one tight window per cohort).

Output: writes a scope JSON {experiment_type, window, run rows...} to --out
(default outputs/cap-cost/<type>/scope.json) and prints a human summary.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import pandas as pd

import cap_cost_db

RUN_COLUMNS = [
    "runId",
    "organizationSlug",
    "experimentType",
    "status",
    "costUsd",
    "durationSeconds",
    "artifactBucket",
    "artifactKey",
    "error",
    "stage",
    "createdAt",
]


def _select(where_sql: str, **params) -> pd.DataFrame:
    cols = ", ".join(f'"{c}"' for c in RUN_COLUMNS)
    sql = f'SELECT {cols} FROM experiment_run WHERE {where_sql} ORDER BY "createdAt" ASC'
    df = cap_cost_db.query(sql, **params)
    if not df.empty:
        df["createdAt"] = pd.to_datetime(df["createdAt"], utc=True)
    return df


def resolve_type_since(experiment_type: str, since: str) -> pd.DataFrame:
    return _select(
        '"experimentType" = :t AND "createdAt" >= :since',
        t=experiment_type,
        since=since,
    )


def resolve_type_on(experiment_type: str, day: str) -> pd.DataFrame:
    start = f"{day}T00:00:00Z"
    end = f"{day}T23:59:59.999Z"
    return _select(
        '"experimentType" = :t AND "createdAt" >= :s AND "createdAt" <= :e',
        t=experiment_type,
        s=start,
        e=end,
    )


def cluster_cohorts(df: pd.DataFrame, gap_hours: float = 2.0) -> list[pd.DataFrame]:
    """Split a time-sorted frame into cohorts: a gap > gap_hours between
    consecutive createdAt starts a new cohort. Newest cohort is last."""
    if df.empty:
        return []
    df = df.sort_values("createdAt").reset_index(drop=True)
    gaps = df["createdAt"].diff().dt.total_seconds().fillna(0)
    cohort_id = (gaps > gap_hours * 3600).cumsum()
    return [g.reset_index(drop=True) for _, g in df.groupby(cohort_id)]


def resolve_last_cohorts(experiment_type: str, n: int, gap_hours: float) -> pd.DataFrame:
    # Pull a generous lookback, then cluster and keep the last n cohorts.
    df = _select('"experimentType" = :t', t=experiment_type)
    cohorts = cluster_cohorts(df, gap_hours=gap_hours)
    if not cohorts:
        return df
    kept = cohorts[-n:]
    return pd.concat(kept, ignore_index=True)


def resolve_run_ids(run_ids: list[str]) -> pd.DataFrame:
    if not run_ids:
        return pd.DataFrame(columns=RUN_COLUMNS)
    placeholders = ", ".join(f":id{i}" for i in range(len(run_ids)))
    params = {f"id{i}": rid for i, rid in enumerate(run_ids)}
    return _select(f'"runId" IN ({placeholders})', **params)


def _read_id_file(path: str) -> list[str]:
    ids: list[str] = []
    with open(path) as f:
        first = True
        for line in f:
            line = line.strip()
            if not line:
                continue
            # tolerate a csv with a run_id column header
            val = line.split(",")[0].strip()
            if first and val.lower() in ("run_id", "runid"):
                first = False
                continue
            first = False
            ids.append(val)
    return ids


def summarize(df: pd.DataFrame) -> dict:
    if df.empty:
        return {"runs": 0}
    return {
        "runs": int(len(df)),
        "window_start_utc": df["createdAt"].min().isoformat(),
        "window_end_utc": df["createdAt"].max().isoformat(),
        "types": df["experimentType"].value_counts().to_dict(),
        "status": df["status"].value_counts().to_dict(),
        "costUsd_sum": round(float(df["costUsd"].fillna(0).sum()), 2),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Resolve a CAP cost-analysis scope to run rows.")
    ap.add_argument("--type", help="experimentType, e.g. meeting_briefing")
    ap.add_argument("--since", help="ISO date/datetime (UTC), runs created at or after")
    ap.add_argument("--on", help="UTC day YYYY-MM-DD — all runs of --type that day")
    ap.add_argument("--last-cohorts", type=int, help="last N dispatch-window cohorts of --type")
    ap.add_argument("--gap-hours", type=float, default=2.0, help="cohort gap threshold (h)")
    ap.add_argument("--run-ids", help="comma-separated explicit run ids")
    ap.add_argument("--run-ids-file", help="file with one run id per line (or csv w/ run_id col)")
    ap.add_argument("--out", help="scope JSON output path")
    a = ap.parse_args()

    if a.run_ids:
        df = resolve_run_ids([x.strip() for x in a.run_ids.split(",") if x.strip()])
        label = "run-ids"
    elif a.run_ids_file:
        df = resolve_run_ids(_read_id_file(a.run_ids_file))
        label = "run-ids-file"
    elif a.type and a.on:
        df = resolve_type_on(a.type, a.on)
        label = f"{a.type} on {a.on}"
    elif a.type and a.last_cohorts:
        df = resolve_last_cohorts(a.type, a.last_cohorts, a.gap_hours)
        label = f"{a.type} last {a.last_cohorts} cohorts"
    elif a.type and a.since:
        df = resolve_type_since(a.type, a.since)
        label = f"{a.type} since {a.since}"
    else:
        ap.error("specify a scope: --run-ids / --run-ids-file / --type with --on|--since|--last-cohorts")
        return

    s = summarize(df)
    print(f"== resolved scope: {label} ==", file=sys.stderr)
    print(json.dumps(s, indent=2), file=sys.stderr)
    if s["runs"] == 0:
        print("!! 0 runs resolved — nothing to analyze", file=sys.stderr)

    exp_type = df["experimentType"].iloc[0] if not df.empty else (a.type or "unknown")
    out = a.out or f"outputs/cap-cost/{exp_type}/scope.json"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    payload = {
        "label": label,
        "resolved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "experiment_type": exp_type,
        "summary": s,
        "runs": json.loads(df.to_json(orient="records", date_format="iso")),
    }
    with open(out, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {out}  ({s['runs']} runs)")


if __name__ == "__main__":
    main()
