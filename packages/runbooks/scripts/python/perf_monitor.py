#!/usr/bin/env python3
"""Real-time performance monitor: gate the latest deployed runs against an experiment's
adopted perf config and ALARM when execution health drifts above its baseline.

Pairs with derive_perf_thresholds.py (which produces the config + baseline) and perf_gate.py
(which scores one batch). Run it on a cadence (a /loop, cron, or launchd job) pointed at dev.

Usage:
  AWS_PROFILE=work AWS_REGION=us-west-2 uv run python perf_monitor.py \
    --config experiment-evals/<exp>/perf.json --env dev -n 30

Exit codes: 0 healthy; 1 drift ALARM; 2 cannot assess (no runs found, or the config's
env stamp does not match --env). S3 infra failures (auth, throttle) raise instead of
being scored — an infra error must never read as "OK" or as a traceless run.
"""
from __future__ import annotations

import argparse
import json
import sys

from eval_trajectory import score
from perf_gate import evaluate, artifact_status, NO_ARTIFACT, lacks_valid_artifact, list_run_ids, s3_text

TOL_NO_ARTIFACT = 0.10  # alarm if the live no-artifact rate exceeds baseline by more than this
TOL_FLAG = 0.20         # alarm if the live FLAG rate exceeds this


def drift_alarm(live_no_artifact_rate, live_flag_rate, baseline_no_artifact_rate,
                tol_no_artifact=TOL_NO_ARTIFACT, tol_flag=TOL_FLAG) -> dict:
    """Pure drift decision. Alarm if no-artifact rate drifts above baseline+tol, or FLAG rate spikes."""
    base = baseline_no_artifact_rate or 0.0
    reasons = []
    if live_no_artifact_rate > base + tol_no_artifact:
        reasons.append(f"no-artifact rate {live_no_artifact_rate:.0%} > baseline {base:.0%} + {tol_no_artifact:.0%}")
    if live_flag_rate > tol_flag:
        reasons.append(f"FLAG rate {live_flag_rate:.0%} > {tol_flag:.0%}")
    return {"alarm": bool(reasons), "reasons": reasons}


def env_mismatch(cfg_env, cli_env) -> bool:
    """True when the config carries an env stamp that differs from the env being gated.
    A baseline derived on one env must never gate another (prod 13% vs dev 33%
    no-artifact baselines differ materially)."""
    return bool(cfg_env) and cfg_env != cli_env


def _latest_run_ids(bucket, exp, n):
    # Listing delegated to perf_gate.list_run_ids, which RAISES on listing failure —
    # a swallowed aws error here once read as n=0 -> "OK" -> the monitor failed open.
    # list_run_ids matches ANY UUID version, but the "tail is newest" trick only holds
    # for UUIDv7 (time-ordered). A v4 (random) id — from an older harness or a manual
    # dispatch — would sort to an arbitrary position and silently pollute the window, so
    # restrict to v7 (version nibble at string index 14) before sorting.
    all_ids = list_run_ids(bucket, exp)
    v7 = [i for i in all_ids if len(i) > 14 and i[14] == "7"]
    dropped = len(all_ids) - len(v7)
    if dropped and not v7:
        # Distinct from a genuinely empty bucket: the runs exist but are unusable here.
        print(f"WARNING: s3://{bucket}/{exp}/ has {dropped} non-UUIDv7 run id(s) and zero "
              "UUIDv7 ids — the monitor needs time-ordered UUIDv7 ids to pick the latest "
              "window; re-dispatch with a UUIDv7-emitting harness.", file=sys.stderr)
    elif dropped:
        print(f"WARNING: ignoring {dropped} non-UUIDv7 run id(s) under s3://{bucket}/{exp}/ "
              "(not time-ordered; cannot be placed in the latest-N window)", file=sys.stderr)
    return sorted(v7)[-n:]


def gate_run(trace_text: str | None, status, cfg: dict) -> dict:
    """Gate one run, INCLUDING runs that left no trace — a traceless run is usually a
    hard failure, and skipping it would understate exactly what the monitor watches.
    With no trace, the verdict comes from the artifact alone (no-artifact -> FAIL;
    artifact present -> FLAG as incomplete via the turns=None path)."""
    m = score(trace_text, [], None) if trace_text else {"turns": None, "cost": 0.0, "tool_errors": 0}
    return evaluate(m, status, cfg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--env", default="dev")
    ap.add_argument("-n", type=int, default=30)
    ap.add_argument("--bucket")
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    if env_mismatch(cfg.get("env"), a.env):
        print(f"ERROR: config {a.config} was derived for env '{cfg['env']}' but --env={a.env}; "
              f"baselines differ materially across envs — re-derive the config for '{a.env}'.",
              file=sys.stderr)
        return 2
    exp = cfg["experiment"]
    bucket = a.bucket or f"gp-agent-artifacts-{a.env}"
    status_field = cfg.get("status_field")

    runs = _latest_run_ids(bucket, exp, a.n)
    if not runs:
        print(f"ERROR: no runs found under s3://{bucket}/{exp}/ — cannot assess health",
              file=sys.stderr)
        return 2
    counts = {"PASS": 0, "FLAG": 0, "FAIL": 0}
    no_artifact = 0
    for rid in runs:
        # s3_text is None ONLY on genuine absence (404); a throttled/denied pull raises
        # instead of misclassifying the run as "ran traceless" (a false FLAG).
        trace = s3_text(bucket, f"{exp}/{rid}/logs/workspace/conversation.jsonl")
        status = artifact_status(rid, bucket, exp, status_field)
        r = gate_run(trace, status, cfg)
        counts[r["verdict"]] += 1
        no_artifact += lacks_valid_artifact(status)

    n = sum(counts.values())
    na_rate = no_artifact / n if n else 0.0
    flag_rate = counts["FLAG"] / n if n else 0.0
    alarm = drift_alarm(na_rate, flag_rate, cfg.get("no_artifact_rate"))

    print(f"[perf-monitor] {exp} @ {a.env}  latest {n} runs")
    print(f"  PASS={counts['PASS']} FLAG={counts['FLAG']} FAIL={counts['FAIL']}")
    print(f"  no-artifact rate: {na_rate:.0%} (baseline {(cfg.get('no_artifact_rate') or 0):.0%})   FLAG rate: {flag_rate:.0%}")
    if alarm["alarm"]:
        print(f"  ALARM: {'; '.join(alarm['reasons'])}")
    else:
        print("  OK (within baseline tolerance)")
    return 1 if alarm["alarm"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
