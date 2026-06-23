#!/usr/bin/env python3
"""Performance gate: the objective head of the two-headed eval.

Judges HOW a run executed (did it produce an artifact, at what cost/turns/errors), not
whether the output is good (that's the quality rubric).

Cross-experiment grounding showed there is NO universal status field (meeting_briefing uses
`briefing_status`, meeting_schedule `status`, others none), so the gate is **config-driven
per experiment**:
  - the one UNIVERSAL hard FAIL is "produced no artifact" (`NO_ARTIFACT`);
  - any status-based FAIL comes from the experiment's `fail_values`;
  - cost/turns/tool-error ceilings (FLAG, for review) come from the experiment's `thresholds`.
Derive the per-experiment config with `derive_perf_thresholds.py`; pass it via `--config`.

For relative A/B gating (did v2 regress vs v1) use `eval_trajectory.py --ab`.

Usage:
  uv run python perf_gate.py <trace_dir> --config <exp>.perf.json
  uv run python perf_gate.py <trace_dir> --exp meeting_schedule --status-field status
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess

from eval_trajectory import score, _load

NO_ARTIFACT = "NO_ARTIFACT"

# The gate resolves each run's artifact from S3 by the run_id it derives from the trace FILENAME
# (basename minus .jsonl). If traces are named anything other than <run_id>.jsonl, every lookup
# misses and the whole arm reports a FALSE 100% NO_ARTIFACT. Trace files must be named by run_id.
_RUN_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def looks_like_run_id(stem: str) -> bool:
    """True if a trace filename stem is a UUID-shaped run_id (so its S3 artifact can be found)."""
    return bool(_RUN_ID_RE.match(stem))
DEFAULT_THRESHOLDS = {"cost_max": 6.0, "turns_max": 80, "tool_errors_max": 2}
# Default config is deliberately minimal: only NO_ARTIFACT is universal. Without a per-experiment
# config the gate will NOT treat an arbitrary status string as a failure.
DEFAULT_CONFIG = {"status_field": None, "fail_values": [], "thresholds": DEFAULT_THRESHOLDS}


def evaluate(metrics: dict, status, config: dict | None = None) -> dict:
    """Pure gate decision for one run. Returns {verdict: PASS|FLAG|FAIL, reasons:[...]}."""
    c = config or DEFAULT_CONFIG
    fail_values = set(c.get("fail_values", []))
    th = c.get("thresholds", DEFAULT_THRESHOLDS)

    if status in (NO_ARTIFACT, "BAD_JSON"):
        # BAD_JSON is equally fatal: a corrupt artifact is no valid artifact, and it can
        # never appear in fail_values (infer_fail_values only matches error/failed words).
        return {"verdict": "FAIL", "reasons": ["no valid artifact produced"]}
    if status is not None and status in fail_values:
        return {"verdict": "FAIL", "reasons": [f"failure status ({status})"]}

    reasons = []
    cost = metrics.get("cost") or 0.0
    turns = metrics.get("turns")
    errs = metrics.get("tool_errors") or 0
    if cost > th["cost_max"]:
        reasons.append(f"cost ${cost:.2f} > ${th['cost_max']:.2f}")
    if turns is None:
        reasons.append("no result record (incomplete trace)")
    elif turns > th["turns_max"]:
        reasons.append(f"turns {turns} > {th['turns_max']}")
    if errs > th["tool_errors_max"]:
        reasons.append(f"tool_errors {errs} > {th['tool_errors_max']}")
    return {"verdict": "FLAG" if reasons else "PASS", "reasons": reasons}


_ABSENT_MARKERS = ("(404)", "NoSuchKey", "does not exist")


def _aws(*args):
    return subprocess.run(["aws", *args], capture_output=True, text=True, env={**os.environ})


def s3_text(bucket: str, key: str) -> str | None:
    """Body of s3://bucket/key; None ONLY when the object is genuinely absent (404).

    Any other failure (auth, network, bucket) raises — an infra error must never
    masquerade as missing data, because "missing artifact" is this system's hard FAIL."""
    p = _aws("s3", "cp", f"s3://{bucket}/{key}", "-")
    if p.returncode != 0:
        err = (p.stderr or "").strip()
        if any(m in err for m in _ABSENT_MARKERS):
            return None
        raise RuntimeError(f"S3 fetch failed for s3://{bucket}/{key} (NOT a missing object): {err[:300]}")
    # Return the body verbatim: a zero-byte 200 means the object EXISTS but is empty —
    # callers must treat that as corrupt (BAD_JSON), never as absent (NO_ARTIFACT).
    return p.stdout


def list_run_ids(bucket: str, exp: str) -> list[str]:
    """All run ids under s3://bucket/exp/ (strict UUID filter). Raises on listing
    failure rather than returning [] — an empty result on auth failure is how a
    monitor fails open."""
    p = _aws("s3", "ls", f"s3://{bucket}/{exp}/")
    if p.returncode != 0:
        raise RuntimeError(f"s3 ls s3://{bucket}/{exp}/ failed (rc={p.returncode}): {(p.stderr or '').strip()[:300]}")
    ids = [ln.split("PRE ")[-1].strip().rstrip("/") for ln in p.stdout.splitlines() if "PRE " in ln]
    return [i for i in ids if looks_like_run_id(i)]


def lacks_valid_artifact(status) -> bool:
    """One definition of "no valid artifact" (absent OR unparseable) shared by the
    gate summary, derive's baseline, and the monitor's live rate."""
    return status in (NO_ARTIFACT, "BAD_JSON")


def artifact_status(rid: str, bucket: str, exp: str, status_field: str | None):
    """NO_ARTIFACT if the run produced none; else the value of status_field (or None).
    Raises (via s3_text) when the fetch fails for any reason other than a missing object."""
    body = s3_text(bucket, f"{exp}/{rid}/artifact.json")
    if body is None:
        return NO_ARTIFACT
    try:
        art = json.loads(body)
    except json.JSONDecodeError:
        return "BAD_JSON"
    if not isinstance(art, dict):
        return "BAD_JSON"  # valid JSON but not an object (null/array): no usable artifact
    if not status_field:
        return None
    return art.get(status_field)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trace_dir")
    ap.add_argument("--config", help="per-experiment perf config JSON (from derive_perf_thresholds.py)")
    ap.add_argument("--exp", help="experiment id (if not in --config)")
    ap.add_argument("--bucket", help="artifacts bucket; defaults from the config's env stamp")
    ap.add_argument("--status-field", help="override the artifact status field")
    a = ap.parse_args()

    cfg = dict(DEFAULT_CONFIG)
    if a.config:
        cfg.update(json.load(open(a.config)))
    exp = a.exp or cfg.get("experiment")
    if not exp:
        ap.error("need --exp or an 'experiment' in --config")
    status_field = a.status_field if a.status_field is not None else cfg.get("status_field")
    # No silent prod default: resolve the bucket from the config's own env stamp, else require it.
    # (A dev trace dir gated against the prod prefix reads as a false 100% NO_ARTIFACT.)
    bucket = a.bucket or (f"gp-agent-artifacts-{cfg['env']}" if cfg.get("env") else None)
    if not bucket:
        ap.error("need --bucket, or an env-stamped --config to derive it from")

    trace_files = [f for f in sorted(glob.glob(os.path.join(a.trace_dir, "*.jsonl"))) if os.path.getsize(f)]
    mislabeled = [os.path.basename(f) for f in trace_files if not looks_like_run_id(os.path.basename(f)[:-6])]
    if mislabeled:
        print("!! WARNING: these trace files are NOT named <run_id>.jsonl, so their S3 artifact")
        print("!! lookup will MISS and report a FALSE NO_ARTIFACT. Rename traces by run_id:")
        for name in mislabeled[:5]:
            print(f"!!   {name}")
        if len(mislabeled) > 5:
            print(f"!!   ... and {len(mislabeled) - 5} more")
        print("-" * 78)

    counts = {"PASS": 0, "FLAG": 0, "FAIL": 0}
    no_artifact = 0
    print(f"{'run':14s}{'status':17s}{'verdict':8s}{'cost':>7s}{'turns':>6s}{'errs':>5s}  reasons")
    print("-" * 78)
    for f in sorted(glob.glob(os.path.join(a.trace_dir, "*.jsonl"))):
        if not os.path.getsize(f):
            continue
        rid = os.path.basename(f)[:-6]
        m = score(_load(f), [], None)
        status = artifact_status(rid, bucket, exp, status_field)
        r = evaluate(m, status, cfg)
        counts[r["verdict"]] += 1
        no_artifact += lacks_valid_artifact(status)
        print(f"{rid[:13]:14s}{str(status)[:16]:17s}{r['verdict']:8s}{(m.get('cost') or 0):>7.2f}"
              f"{str(m.get('turns')):>6s}{m.get('tool_errors', 0):>5d}  {'; '.join(r['reasons'])}")
    n = sum(counts.values())
    print("-" * 78)
    print(f"exp={exp}  status_field={status_field}  fail_values={cfg.get('fail_values')}")
    print(f"runs: {n}  PASS={counts['PASS']}  FLAG={counts['FLAG']}  FAIL={counts['FAIL']}")
    if n:
        print(f"no-valid-artifact failure rate: {no_artifact}/{n} = {100*no_artifact/n:.0f}%")
    print(f"thresholds: {cfg.get('thresholds')}")


if __name__ == "__main__":
    main()
