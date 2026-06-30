#!/usr/bin/env python3
"""Stage 2 — per-turn extractor -> one cached parquet.

For every run in the scope JSON (from cap_cost_scope.py), fetch
  s3://<artifactBucket>/<experimentType>/<runId>/logs/session.jsonl
parse per-turn token usage, and attribute the run's TRUSTED costUsd across its
turns proportionally by that turn's token total:

    cost_of_turn_i = costUsd * (tokens_i / sum_tokens_over_run)

This is the ONLY way per-turn dollars are produced. We never multiply token
counts by a list price — the DB costUsd is the invoice-validated number and the
token totals are used solely as WEIGHTS to distribute it (see SKILL.md).

We write ONE parquet for the whole cohort so re-analysis (stages 3-6) reads the
parquet and never re-pulls S3. Coverage (logs parsed / runs in scope) is printed
and stored alongside.

Per-turn token weight = input + output + cache_creation + cache_read (the same
four fields the runner bills on). A run with no parsable turns / zero tokens
still appears in the manifest with its costUsd but contributes no turn rows.

Usage:
  cap_cost_extract.py --scope outputs/cap-cost/meeting_briefing/scope.json \
      --out outputs/cap-cost/meeting_briefing/turns.parquet
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import boto3
import pandas as pd

# Reference only — NEVER compute spend from this. The trusted dollar figure is
# experiment_run.costUsd. This table is kept only so a reader can sanity-check
# relative token mix; see the analyze-cap-agent-costs skill.
REFERENCE_PRICING_USD_PER_MTOK = {
    "opus": dict(input=5.00, cache_write_5m=6.25, cache_read=0.50, output=25.00),
    "sonnet": dict(input=3.00, cache_write_5m=3.75, cache_read=0.30, output=15.00),
    "haiku": dict(input=1.00, cache_write_5m=1.25, cache_read=0.10, output=5.00),
}


def parse_session(text: str) -> list[dict]:
    """Per-turn token usage from a session.jsonl. Reused (de-regexed) from
    the original analyze-experiment-costs parser — every assistant message with a
    usage block is one turn. Returns ordered turn dicts."""
    turns: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get("message")
        if not isinstance(msg, dict):
            continue
        usage = msg.get("usage")
        if not isinstance(usage, dict):
            continue
        tool_calls = [
            c.get("name", "")
            for c in (msg.get("content") or [])
            if isinstance(c, dict) and c.get("type") == "tool_use"
        ]
        turns.append(
            {
                "model": msg.get("model"),
                "input": usage.get("input_tokens", 0) or 0,
                "output": usage.get("output_tokens", 0) or 0,
                "cache_creation": usage.get("cache_creation_input_tokens", 0) or 0,
                "cache_read": usage.get("cache_read_input_tokens", 0) or 0,
                "tool_calls": tool_calls,
                "timestamp": obj.get("timestamp"),
            }
        )
    return turns


def _session_key(experiment_type: str, run_id: str) -> str:
    return f"{experiment_type}/{run_id}/logs/session.jsonl"


def _fetch_session(s3, bucket: str, key: str) -> str | None:
    from botocore.exceptions import ClientError, NoCredentialsError

    try:
        resp = s3.get_object(Bucket=bucket, Key=key)
        return resp["Body"].read().decode("utf-8", errors="replace")
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        raise
    except NoCredentialsError:
        raise


def turn_rows_for_run(run: dict, text: str) -> list[dict]:
    """Build per-turn rows with proportional cost attribution for one run."""
    turns = parse_session(text)
    cost_usd = run.get("costUsd") or 0.0
    totals = [t["input"] + t["output"] + t["cache_creation"] + t["cache_read"] for t in turns]
    sum_tokens = sum(totals)
    rows = []
    for idx, (t, tok) in enumerate(zip(turns, totals)):
        est_cost = (cost_usd * tok / sum_tokens) if sum_tokens else 0.0
        rows.append(
            {
                "run_id": run["runId"],
                "experiment_type": run["experimentType"],
                "organization_slug": run.get("organizationSlug"),
                "status": run.get("status"),
                "turn_idx": idx,
                "model": t["model"],
                "input": t["input"],
                "output": t["output"],
                "cache_creation": t["cache_creation"],
                "cache_read": t["cache_read"],
                "tokens": tok,
                "est_cost": est_cost,
                "tool_calls": ",".join(tc for tc in t["tool_calls"] if tc),
                "timestamp": t["timestamp"],
                "run_cost_usd": cost_usd,
            }
        )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract per-turn cost-weighted rows to parquet.")
    ap.add_argument("--scope", required=True, help="scope JSON from cap_cost_scope.py")
    ap.add_argument("--out", help="parquet output path")
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()

    with open(a.scope) as f:
        scope = json.load(f)
    runs = scope["runs"]
    exp_type = scope.get("experiment_type", "unknown")
    if not runs:
        sys.exit("scope has 0 runs — nothing to extract")

    region = os.environ.get("AWS_REGION", "us-west-2")

    def pull(run):
        s3 = boto3.client("s3", region_name=region)
        bucket = run.get("artifactBucket") or "gp-agent-artifacts-prod"
        # artifactKey points at artifact.json; the session log is a sibling. Prefer
        # deriving from experimentType/runId (matches the S3 layout convention).
        key = _session_key(run["experimentType"], run["runId"])
        text = _fetch_session(s3, bucket, key)
        if text is None:
            return run["runId"], None
        return run["runId"], turn_rows_for_run(run, text)

    parsed = 0
    all_rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for run_id, rows in ex.map(pull, runs):
            if rows is None:
                continue
            parsed += 1
            all_rows.extend(rows)

    coverage = {
        "runs_in_scope": len(runs),
        "logs_parsed": parsed,
        "coverage_pct": round(100 * parsed / len(runs), 1) if runs else 0.0,
        "turn_rows": len(all_rows),
    }
    print(json.dumps(coverage, indent=2), file=sys.stderr)
    if parsed < len(runs):
        print(
            f"!! coverage {coverage['coverage_pct']}% — {len(runs) - parsed} runs had no "
            f"session.jsonl (in-progress, crashed pre-log, or wrong bucket). Population "
            f"analytics will report this coverage.",
            file=sys.stderr,
        )

    out = a.out or f"outputs/cap-cost/{exp_type}/turns.parquet"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    df = pd.DataFrame(all_rows)
    df.to_parquet(out, index=False)
    cov_path = os.path.splitext(out)[0] + ".coverage.json"
    with open(cov_path, "w") as f:
        json.dump(coverage, f, indent=2)
    print(f"wrote {out}  ({len(all_rows)} turn rows over {parsed} runs)")


if __name__ == "__main__":
    main()
