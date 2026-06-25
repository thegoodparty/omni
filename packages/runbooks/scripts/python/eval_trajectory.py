#!/usr/bin/env python3
"""Trajectory eval: score an agent run's *execution trace* (conversation.jsonl) —
how it worked (turns, cost, tool errors, planning overhead, redundancy), as
opposed to quality eval (cold-judge rubric, tallied by rubric_verdict.py) which scores the *artifact*.

Reads the trace the PMF runner uploads to
  s3://gp-agent-artifacts-<env>/<experiment>/<run_id>/logs/workspace/conversation.jsonl

Handles both trace dialects: the Fargate harness writes flat
`{"type":"tool_result"}` records; local Claude-Code runs nest tool results inside
`{"type":"user"}` records.

Usage:
  # one directory of *.jsonl traces -> per-run table + aggregate
  uv run python eval_trajectory.py <trace_dir>

  # A/B: two dirs, matched by filename -> control vs treatment with deltas
  uv run python eval_trajectory.py --ab <control_dir> <treatment_dir>

  # optional: pull a run's status from the trace for outcome-parity checks
  uv run python eval_trajectory.py <dir> --status-regex 'awaiting_agenda|briefing_ready|no_meeting_found'

  # optional: command-regex categories (e.g. meeting_briefing rules) for a
  # category breakdown beyond the built-in generic metrics
  uv run python eval_trajectory.py <dir> --rules meeting_briefing_eval_rules.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
from collections import Counter

PLANNING_TOOLS = {"TaskCreate", "TaskUpdate", "TaskStop", "TaskOutput", "TodoWrite"}


def _records(text: str):
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def parse_trace(text: str) -> dict:
    """Return {tool_calls:[(name,input)], tool_errors:int, num_turns, cost_usd}."""
    calls, n_err = [], 0
    num_turns = cost = None
    for rec in _records(text):
        t = rec.get("type")
        if t == "assistant":
            for b in rec.get("message", {}).get("content", []) or []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    calls.append((b.get("name", ""), b.get("input") or {}))
        elif t == "tool_result":  # harness dialect
            if rec.get("is_error"):
                n_err += 1
        elif t == "user":  # CLI dialect
            for b in rec.get("message", {}).get("content", []) or []:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"):
                    n_err += 1
        elif t == "result":
            num_turns = rec.get("num_turns", num_turns)
            cost = rec.get("total_cost_usd", cost)
    return {"calls": calls, "tool_errors": n_err, "num_turns": num_turns, "cost_usd": cost or 0.0}


def categorize(name: str, inp: dict, rules: list[dict]) -> str:
    if name in PLANNING_TOOLS:
        return "planning"
    blob = inp.get("command") or inp.get("query") or inp.get("url") or json.dumps(inp)
    for rule in rules:
        if re.search(rule["pattern"], blob):
            return rule["label"]
    return f"tool:{name}"


def exact_dup_count(calls) -> int:
    seen, dups = set(), 0
    for name, inp in calls:
        key = (name, json.dumps(inp, sort_keys=True, default=str))
        if key in seen:
            dups += 1
        else:
            seen.add(key)
    return dups


def score(text: str, rules: list[dict], status_regex: str | None) -> dict:
    p = parse_trace(text)
    cats = Counter(categorize(n, i, rules) for n, i in p["calls"])
    n = len(p["calls"])
    status = None
    if status_regex:
        m = re.findall(status_regex, text)
        status = m[-1] if m else None
    return {
        "turns": p["num_turns"],
        "steps": n,
        "cost": round(p["cost_usd"], 2),
        "tool_errors": p["tool_errors"],
        "exact_dups": exact_dup_count(p["calls"]),
        "planning": cats.get("planning", 0),
        "planning_pct": round(100 * cats.get("planning", 0) / n, 1) if n else 0.0,
        "status": status,
        "cats": dict(cats),
    }


def _load(path):
    return open(path, encoding="utf-8", errors="replace").read()


def ab_label(name: str) -> str:
    """A/B pairing key for a trace filename stem: the trailing label after the
    last '__' (the `<arm>__<input-label>` convention), else the full name."""
    return name.split("__")[-1]


def ab_maps(ctrl_rows: dict, treat_rows: dict) -> tuple[dict, dict, set, set]:
    """Per-arm {ab_label: row} maps plus the unpaired label sets.
    Raises ValueError when two files in the same arm collapse to one ab_label —
    silently last-write-winning would score the wrong run (the exact hazard
    ab_savings.group_runs raises on)."""
    def by_label(rows: dict, arm: str) -> dict:
        out, first_name = {}, {}
        for name, row in rows.items():
            key = ab_label(name)
            if key in out:
                raise ValueError(
                    f"ab_label collision in {arm} arm: "
                    f"'{first_name[key]}' and '{name}' both map to '{key}'")
            out[key] = row
            first_name[key] = name
        return out

    cmap, tmap = by_label(ctrl_rows, "control"), by_label(treat_rows, "treatment")
    return cmap, tmap, set(cmap) - set(tmap), set(tmap) - set(cmap)


def ab_pair_includable(c: dict, t: dict):
    """Whether a control/treatment pair may enter the aggregate totals.
    A status mismatch means the arms did different work (the delta is confounded),
    and a missing result record means turns are unknown — both must be excluded,
    not just warned about."""
    if c.get("status") != t.get("status"):
        return False, f"outcome mismatch: ctrl={c.get('status')} treat={t.get('status')}"
    if c.get("turns") is None or t.get("turns") is None:
        return False, f"incomplete: ctrl turns={c.get('turns')} treat turns={t.get('turns')}"
    return True, None


def parity_line(mismatch_seen: bool, n_complete: int) -> str:
    """The outcome-parity verdict for the A/B footer.

    "OK" is only honest when at least one complete, outcome-matched pair was actually
    validated. A run where every pair was excluded as incomplete (turns unknown) checked
    nothing, so it must read NOT VALIDATED, never "OK (all inputs match)"."""
    if mismatch_seen:
        return "outcome parity: BROKEN — fix before trusting the delta"
    if n_complete == 0:
        return "outcome parity: NOT VALIDATED (no complete, outcome-matched pairs)"
    return f"outcome parity: OK ({n_complete} matched pair(s))"


def run_dir(d: str, rules, status_regex):
    rows = {}
    for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        rows[os.path.basename(f)[:-6]] = score(_load(f), rules, status_regex)
    return rows


def _print_table(rows: dict):
    hdr = f"{'run':28s}{'status':17s}{'turns':>6s}{'steps':>6s}{'cost':>7s}{'errs':>5s}{'dups':>5s}{'plan%':>6s}"
    print(hdr)
    print("-" * len(hdr))
    tt = ts = tc = 0
    for name, r in rows.items():
        print(f"{name[:28]:28s}{str(r['status'] or '-'):17s}{str(r['turns']):>6s}{r['steps']:>6d}"
              f"{r['cost']:>7.2f}{r['tool_errors']:>5d}{r['exact_dups']:>5d}{r['planning_pct']:>6.1f}")
        tt += r["turns"] or 0
        ts += r["steps"]
        tc += r["cost"]
    print("-" * len(hdr))
    print(f"{'TOTAL':28s}{'':17s}{tt:>6d}{ts:>6d}{tc:>7.2f}")
    return tt, ts, tc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("treatment_dir", nargs="?")
    ap.add_argument("--ab", action="store_true", help="A/B: dir=control, treatment_dir=treatment")
    ap.add_argument("--rules", help="JSON list of {pattern,label} command-category rules")
    ap.add_argument("--status-regex", help="regex; last match in the trace is the run's outcome")
    a = ap.parse_args()
    rules = json.load(open(a.rules)) if a.rules else []

    if a.ab:
        if not a.treatment_dir:
            ap.error("--ab requires control_dir AND treatment_dir")
        ctrl, treat = run_dir(a.dir, rules, a.status_regex), run_dir(a.treatment_dir, rules, a.status_regex)
        cmap, tmap, only_ctrl, only_treat = ab_maps(ctrl, treat)
        for arm, only in (("control", only_ctrl), ("treatment", only_treat)):
            if only:
                print(f"!! unpaired (excluded): {arm}-only: {', '.join(sorted(only))}")
        keys = sorted(set(cmap) & set(tmap))
        print(f"{'input':16s}{'arm':6s}{'status':17s}{'turns':>6s}{'cost':>7s}{'plan%':>6s}{'errs':>5s}{'dups':>5s}")
        print("-" * 70)
        ct = tt = 0
        cc = tc = 0.0
        mismatch_seen = False
        n_complete = 0
        for k in keys:
            c, t = cmap[k], tmap[k]
            print(f"{k[:16]:16s}{'ctrl':6s}{str(c['status'] or '-'):17s}{str(c['turns']):>6s}{c['cost']:>7.2f}{c['planning_pct']:>6.1f}{c['tool_errors']:>5d}{c['exact_dups']:>5d}")
            print(f"{'':16s}{'treat':6s}{str(t['status'] or '-'):17s}{str(t['turns']):>6s}{t['cost']:>7.2f}{t['planning_pct']:>6.1f}{t['tool_errors']:>5d}{t['exact_dups']:>5d}")
            include, why = ab_pair_includable(c, t)
            if include:
                ct += c["turns"]
                tt += t["turns"]
                cc += c["cost"]
                tc += t["cost"]
                n_complete += 1
            else:
                if "mismatch" in why:
                    mismatch_seen = True
                print(f"  !! {why} — excluded from totals")
            print()
        print("=" * 70)
        print(f"clean paired inputs (parity + complete): {n_complete}/{len(keys)}; totals below cover ONLY these")
        print(f"control   turns={ct:5d}  cost=${cc:6.2f}")
        print(f"treatment turns={tt:5d}  cost=${tc:6.2f}")
        if ct:
            print(f"delta     turns={100*(ct-tt)/ct:+.0f}% (negative = treatment worse)   cost={100*(cc-tc)/max(1e-9,cc):+.0f}%")
        if a.status_regex:
            print(parity_line(mismatch_seen, n_complete))
        else:
            print("outcome parity: NOT CHECKED (no --status-regex; use ab_savings.py for true-status parity)")
    else:
        rows = run_dir(a.dir, rules, a.status_regex)
        _print_table(rows)


if __name__ == "__main__":
    main()
