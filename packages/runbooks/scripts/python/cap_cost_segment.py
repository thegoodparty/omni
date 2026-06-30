#!/usr/bin/env python3
"""Stage 6 (opt-in) — district-size segmentation.

Only run this when the question implies district scaling ("does cost grow with
district size?"). It joins the cohort's runs to district size and reports cost
per size segment, using the SAME voter-count buckets as
create-representative-test-cohort:
    <10k / 10k-50k / 50k-100k / >100k   (total registered voters)
sourced from Databricks int__icp_offices.voter_count.

Cohort org slugs are `eo-<electedOfficeId>` (serve). We resolve each org to a
ballotready position via the serve resolution mart, then to voter_count. Orgs
that do not resolve (non-serve / non-ICP) are reported as 'unresolved' so the
segmentation stays population-honest.

Cost per segment uses the trusted experiment_run.costUsd from the scope JSON.

Databricks auth: same as databricks_query.py — env DATABRICKS_SERVER_HOSTNAME /
DATABRICKS_HTTP_PATH / DATABRICKS_API_KEY (or reuse databricks_query.execute_query).

Usage:
  cap_cost_segment.py --scope outputs/cap-cost/meeting_briefing/scope.json
"""
from __future__ import annotations

import argparse
import json
import os

import pandas as pd

from databricks_query import execute_query

CATALOG = "goodparty_data_catalog.dbt"


def _bucket(voter_count) -> str:
    if voter_count is None:
        return "unresolved"
    v = float(voter_count)
    if v < 10000:
        return "1:<10k"
    if v < 50000:
        return "2:10k-50k"
    if v < 100000:
        return "3:50k-100k"
    return "4:>100k"


def voter_counts_for_orgs(org_slugs: list[str]) -> pd.DataFrame:
    """org_slug -> voter_count. Serve path: slug `eo-<id>` -> electedOffice ->
    position -> int__icp_offices.voter_count. We resolve via the serve resolution
    mart keyed on the elected office's organization slug."""
    if not org_slugs:
        return pd.DataFrame(columns=["org_slug", "voter_count"])
    in_list = ", ".join("'" + s.replace("'", "''") + "'" for s in org_slugs)
    sql = f"""
    SELECT sdr.organization_slug AS org_slug, io.voter_count
    FROM {CATALOG}.int__serve_district_resolution sdr
    JOIN {CATALOG}.int__icp_offices io
      ON sdr.ballotready_position_id = io.br_database_position_id
    WHERE sdr.organization_slug IN ({in_list})
    """
    try:
        return execute_query(sql)
    except Exception as e:
        # The exact slug column may differ across mart versions; surface it rather
        # than silently returning empty (which would mislabel everything 'unresolved').
        raise SystemExit(
            f"Databricks segmentation query failed: {e}\n"
            f"Confirm int__serve_district_resolution exposes an org-slug column "
            f"(adjust the SELECT/JOIN above to your mart)."
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="District-size cost segmentation (opt-in).")
    ap.add_argument("--scope", required=True)
    ap.add_argument("--out")
    a = ap.parse_args()

    with open(a.scope) as f:
        scope = json.load(f)
    runs = scope["runs"]
    exp_type = scope["experiment_type"]

    cost_by_slug: dict[str, float] = {}
    for r in runs:
        slug = r.get("organizationSlug")
        if not slug:
            continue
        cost_by_slug[slug] = cost_by_slug.get(slug, 0.0) + (r.get("costUsd") or 0.0)

    vc = voter_counts_for_orgs(list(cost_by_slug.keys()))
    vc_map = dict(zip(vc["org_slug"], vc["voter_count"])) if not vc.empty else {}

    rows = []
    for slug, cost in cost_by_slug.items():
        rows.append({"org_slug": slug, "cost": cost, "tier": _bucket(vc_map.get(slug))})
    df = pd.DataFrame(rows)

    seg = (
        df.groupby("tier")
        .agg(orgs=("org_slug", "nunique"), total_cost=("cost", "sum"), mean_cost=("cost", "mean"))
        .reset_index()
        .sort_values("tier")
    )
    seg["total_cost"] = seg["total_cost"].round(2)
    seg["mean_cost"] = seg["mean_cost"].round(2)
    result = {
        "experiment_type": exp_type,
        "buckets": "<10k / 10k-50k / 50k-100k / >100k (int__icp_offices.voter_count)",
        "segments": seg.to_dict(orient="records"),
    }

    out = a.out or f"outputs/cap-cost/{exp_type}/segments.json"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
