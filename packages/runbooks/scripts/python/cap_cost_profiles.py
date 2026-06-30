#!/usr/bin/env python3
"""Stage 5 — per-job profiles.

A small registry mapping experimentType -> profile {status field name, success
status, outcome buckets, headline-metric function}. The status field is the
artifact field (meeting_briefing uses briefing_status; others use status); the
outcome lives in the S3 artifact.json, not the DB. This stage fetches each run's
artifact, buckets by outcome, and computes the profile's headline metric.

Headline metrics use the trusted experiment_run.costUsd (carried in the scope
JSON), never token x list price.

meeting_briefing headline = sum(costUsd) / count(briefing_ready) = dollars per
delivered briefing INCLUDING failed attempts. Human guidance lives in
.claude/skills/analyze-cap-agent-costs/profiles/meeting_briefing.md.

Usage:
  cap_cost_profiles.py --scope outputs/cap-cost/meeting_briefing/scope.json
"""
from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import boto3


def _meeting_briefing_headline(rows: list[dict], outcomes: dict[str, str]) -> dict:
    total_cost = sum((r.get("costUsd") or 0.0) for r in rows)
    ready = sum(1 for v in outcomes.values() if v == "briefing_ready")
    return {
        "metric": "dollars_per_delivered_briefing_incl_failures",
        "total_cost_usd": round(total_cost, 2),
        "briefing_ready": ready,
        "value": round(total_cost / ready, 2) if ready else None,
        "note": "includes the cost of awaiting_agenda / no_meeting_found / FAILED attempts",
    }


# experimentType -> profile. Add a profile per job as it gets analyzed.
PROFILES: dict[str, dict] = {
    "meeting_briefing": {
        "status_field": "briefing_status",
        "success_status": "briefing_ready",
        "outcome_buckets": ["briefing_ready", "awaiting_agenda", "no_meeting_found"],
        "headline": _meeting_briefing_headline,
    },
}


def _fetch_outcome(s3, run: dict, status_field: str) -> str:
    """Read the artifact's status field; classify DB-FAILED and missing artifacts."""
    if run.get("status") == "FAILED":
        return "FAILED"
    bucket = run.get("artifactBucket") or "gp-agent-artifacts-prod"
    key = run.get("artifactKey") or f"{run['experimentType']}/{run['runId']}/artifact.json"
    from botocore.exceptions import ClientError, NoCredentialsError

    try:
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        art = json.loads(body)
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return "no_artifact"
        raise
    except NoCredentialsError:
        raise
    return art.get(status_field) or art.get("status") or "unknown"


def main() -> None:
    ap = argparse.ArgumentParser(description="Per-job outcome bucketing + headline metric.")
    ap.add_argument("--scope", required=True)
    ap.add_argument("--out")
    a = ap.parse_args()

    with open(a.scope) as f:
        scope = json.load(f)
    runs = scope["runs"]
    exp_type = scope["experiment_type"]
    profile = PROFILES.get(exp_type)
    if profile is None:
        raise SystemExit(
            f"no profile registered for '{exp_type}'. Add one to PROFILES in "
            f"cap_cost_profiles.py (status_field, success_status, outcome_buckets, headline)."
        )

    region = os.environ.get("AWS_REGION", "us-west-2")
    status_field = profile["status_field"]

    def grab(run):
        _s3 = boto3.client("s3", region_name=region)
        return run["runId"], _fetch_outcome(_s3, run, status_field)

    outcomes: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        for run_id, outcome in ex.map(grab, runs):
            outcomes[run_id] = outcome

    buckets = Counter(outcomes.values())
    headline = profile["headline"](runs, outcomes)
    result = {
        "experiment_type": exp_type,
        "status_field": status_field,
        "success_status": profile["success_status"],
        "n_runs": len(runs),
        "outcome_counts": dict(buckets),
        "headline": headline,
    }

    out = a.out or f"outputs/cap-cost/{exp_type}/profile.json"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
