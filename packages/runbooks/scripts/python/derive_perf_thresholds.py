#!/usr/bin/env python3
"""Derive a per-experiment performance config (the 'performance rubric') from real runs.

Performance is objective, so no agent or judge is needed — this is measurement. It samples
an experiment's deployed runs, DISCOVERS its status field (which varies: briefing_status /
status / none), computes the cost/turns/error distribution over artifact-producing runs, sets
FLAG ceilings at p95, infers fail-status values heuristically (a status named error/failed),
and emits a config consumable by perf_gate.py --config.

Usage: AWS_PROFILE=work AWS_REGION=us-west-2 uv run python derive_perf_thresholds.py <exp> --env dev -n 60
"""
import argparse
import json
import os
import random
import statistics as st
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from eval_trajectory import score, _load
from perf_gate import list_run_ids

FAIL_WORDS = ("error", "failed", "failure")
ABSENT_MARKERS = ("(404)", "NoSuchKey", "does not exist")


def _aws(*args):
    return subprocess.run(["aws", *args], capture_output=True, text=True, env={**os.environ})


def _list_runs(bucket, exp, n):
    """Random sample of n run ids. Listing goes through perf_gate.list_run_ids
    (strict UUIDs, RAISES on aws failure — never a silent empty sample)."""
    ids = list_run_ids(bucket, exp)
    random.shuffle(ids)
    return ids[:n]


def classify_cp(returncode, stderr) -> str:
    """One `aws s3 cp` outcome. "absent" = object genuinely missing (404 — expected
    for many runs); "error" = any other failure (auth/network/throttling), which is
    infra noise and must never be mistaken for a missing artifact."""
    if returncode == 0:
        return "ok"
    return "absent" if any(m in (stderr or "") for m in ABSENT_MARKERS) else "error"


def pct(vals, p):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    k = max(0, min(len(vals) - 1, int(round(p / 100 * (len(vals) - 1)))))
    return vals[k]


def discover_status_field(artifacts):
    """Most common *status*-named key across dict artifacts, or None (no universal field exists)."""
    sfields = Counter()
    for art in artifacts:
        if isinstance(art, dict):
            for k in art:
                if "status" in k.lower():
                    sfields[k] += 1
    return sfields.most_common(1)[0][0] if sfields else None


def no_valid_artifact(art) -> bool:
    """True when a run produced no usable artifact: missing (None), unparseable
    ("BAD"), or parseable but not a JSON object (array/null — the same class
    perf_gate counts as BAD_JSON). All count toward the no-artifact baseline and
    stay out of the cost/turns distribution, keeping baseline and live gate aligned."""
    return not isinstance(art, dict)


def cap_sample(rows, n):
    """Trim the 2x oversample back to the operator's -n so the recorded n and the
    p95 population match the intent (the sample is shuffled, so trimming is unbiased)."""
    return rows[:n]


def require_complete_runs(present, n_rows, exp, noart):
    """Refuse to emit ceilings when NO sampled run has both a trace and a valid
    artifact — pct([]) collapses to cost_max 0 and every future healthy run FLAGs."""
    if not present:
        raise SystemExit(
            f"ERROR: 0 of {n_rows} sampled {exp} runs have both a trace and a valid artifact "
            f"(no-valid-artifact count: {noart}) — refusing to write ceilings from an empty "
            f"distribution; investigate the failures first"
        )


def classify_run(has_trace: bool, art) -> str:
    """Population definition shared with perf_monitor: every sampled run is in the
    no-artifact denominator, traceless or not. "no_valid_artifact" = artifact absent
    or unparseable; "complete" = trace + valid artifact (feeds the cost/turns
    distribution); "artifact_only" = valid artifact but no trace (stays in the
    denominator, out of the distribution)."""
    if no_valid_artifact(art):
        return "no_valid_artifact"
    return "complete" if has_trace else "artifact_only"


def aggregate_rows(rows, status_field):
    """rows: (rid, metrics_or_None, art) for EVERY attempted sampled run.
    Returns (present_metrics, noart, statuses); the no-artifact denominator is len(rows)."""
    statuses = Counter()
    present, noart = [], 0
    for _rid, m, art in rows:
        cls = classify_run(m is not None, art)
        if cls == "no_valid_artifact":
            noart += 1
            continue
        if status_field and isinstance(art, dict):
            statuses[str(art.get(status_field))] += 1
        if cls == "complete":
            present.append(m)
    return present, noart, statuses


def infer_fail_values(statuses, status_field):
    """Observed failure-word statuses, plus a presumed "error" whenever a status field exists
    (failures are rare; a small sample often misses them)."""
    fail_values = sorted({s for s in statuses if any(w in s.lower() for w in FAIL_WORDS)})
    if status_field and "error" not in fail_values:
        fail_values.append("error")
    return fail_values


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("exp")
    ap.add_argument("--env", default="dev")
    ap.add_argument("-n", type=int, default=60)
    ap.add_argument("--bucket")
    a = ap.parse_args()
    bucket = a.bucket or f"gp-agent-artifacts-{a.env}"
    out = f"outputs/perf-eval/{a.exp}/derive-{a.env}"
    os.makedirs(f"{out}/traces", exist_ok=True)
    os.makedirs(f"{out}/artifacts", exist_ok=True)
    runs = _list_runs(bucket, a.exp, a.n * 2)  # oversample; some runs lack files

    def pull(rid):
        """True when the run is usable (objects present or genuinely absent);
        False on any non-404 failure — that run is infra noise, not data."""
        outcomes = []
        for src, dst in (
            (f"s3://{bucket}/{a.exp}/{rid}/logs/workspace/conversation.jsonl", f"{out}/traces/{rid}.jsonl"),
            (f"s3://{bucket}/{a.exp}/{rid}/artifact.json", f"{out}/artifacts/{rid}.json"),
        ):
            p = _aws("s3", "cp", src, dst, "--quiet")
            outcomes.append(classify_cp(p.returncode, p.stderr))
        return "error" not in outcomes

    with ThreadPoolExecutor(max_workers=12) as ex:
        fetched = list(ex.map(pull, runs))
    fetch_failures = sum(1 for ok in fetched if not ok)
    if fetch_failures:
        print(f"!! WARNING: {fetch_failures}/{len(runs)} sampled runs hit non-404 S3 fetch failures "
              f"(auth/network/throttling) — dropped from the sample so infra noise does not inflate "
              f"the no-artifact baseline", file=sys.stderr)

    rows = []
    for rid, ok in zip(runs, fetched):
        if not ok:
            continue
        tf, af = f"{out}/traces/{rid}.jsonl", f"{out}/artifacts/{rid}.json"
        m = score(_load(tf), [], None) if os.path.exists(tf) and os.path.getsize(tf) else None
        art = None
        if os.path.exists(af) and os.path.getsize(af):
            try:
                art = json.load(open(af))
            except json.JSONDecodeError:
                art = "BAD"
        rows.append((rid, m, art))
    if not rows:
        sys.exit(f"ERROR: no usable runs sampled for {a.exp} in s3://{bucket}/{a.exp}/ "
                 f"({len(runs)} listed, {fetch_failures} fetch failures) — refusing to write a config")
    rows = cap_sample(rows, a.n)
    # Discover AFTER capping so the emitted status_field describes the same n rows
    # that produce status_counts and the thresholds (a mixed-key oversample could
    # otherwise vote in a field the capped sample disagrees with).
    status_field = discover_status_field(art for _rid, _m, art in rows)
    present, noart, statuses = aggregate_rows(rows, status_field)
    require_complete_runs(present, len(rows), a.exp, noart)
    fail_values = infer_fail_values(statuses, status_field)

    costs = [m["cost"] for m in present]
    turns = [m["turns"] for m in present if m["turns"] is not None]
    errs = [m["tool_errors"] for m in present]
    thresholds = {
        "cost_max": round(pct(costs, 95) or 0, 2),
        "turns_max": pct(turns, 95) or 0,
        "tool_errors_max": max(2, pct(errs, 95) or 0),
    }
    cfg = {
        "experiment": a.exp, "env": a.env, "n": len(rows),
        "derived_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status_field": status_field, "fail_values": fail_values,
        "thresholds": thresholds,
        "no_artifact_rate": round(noart / len(rows), 3),
        "status_counts": dict(statuses),
        "distribution": {
            "cost": {"median": round(st.median(costs), 2) if costs else None, "p95": thresholds["cost_max"], "max": round(max(costs), 2) if costs else None},
            "turns": {"median": st.median(turns) if turns else None, "p95": thresholds["turns_max"], "max": max(turns) if turns else None},
        },
    }
    cfgpath = f"outputs/perf-eval/{a.exp}/{a.exp}.{a.env}.perf.json"
    json.dump(cfg, open(cfgpath, "w"), indent=2)
    print(json.dumps(cfg, indent=2))
    print(f"\nwrote {cfgpath}")


if __name__ == "__main__":
    main()
