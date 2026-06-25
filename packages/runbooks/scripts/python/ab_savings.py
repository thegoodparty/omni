#!/usr/bin/env python3
"""A/B savings table — per-input v1-vs-v2 cost/turns/planning, joined to TRUE artifact status.

Complements `eval_trajectory.py --ab`: that diffs two trace dirs using a status REGEX heuristic;
this pulls each run's artifact.json from S3 for the real `status_field` outcome, so the
outcome-parity check is exact. A pair enters the CLEAN PAIRS aggregate only when the statuses
match, both traces are complete (turns known), and the matched status is a valid artifact
outcome (not NO_ARTIFACT/BAD_JSON) — anything else is flagged with its exclusion reason and
EXCLUDED (a divergent outcome means the arms did different work, and a truncated trace or
missing artifact contributes $0/0 turns that flips the headline — see
books/evaluate-experiment-runs.md).

Input is a runs-map TSV with a header and columns: exp, arm (ctrl|treat), path, label, run_id.
(The same map you build when dispatching the A/B — one row per dispatched run.)

Usage:
  uv run python ab_savings.py runs_map.tsv --bucket gp-agent-artifacts-dev --status-field briefing_status
"""
from __future__ import annotations

import argparse
import csv
import json

from eval_trajectory import ab_pair_includable, score
from perf_gate import NO_ARTIFACT, s3_text


def fetch_artifact(bucket: str, exp: str, rid: str, status_field: str | None = None):
    """One S3 fetch of the run's artifact.json -> (status, parsed artifact | None).

    Status carries perf_gate.artifact_status semantics EXACTLY — NO_ARTIFACT when the
    object is absent, "BAD_JSON" when present but unparseable, else the status_field
    value (None when no field is configured or the field is absent). Parity is locked
    by test_artifact_status_semantics_match_perf_gate; the body rides along so callers
    never fetch the same artifact twice. Infra failures raise via s3_text rather than
    masquerading as a missing artifact."""
    body = s3_text(bucket, f"{exp}/{rid}/artifact.json")
    if body is None:
        return NO_ARTIFACT, None
    try:
        art = json.loads(body)
    except json.JSONDecodeError:
        return "BAD_JSON", None
    if not isinstance(art, dict):
        return "BAD_JSON", None  # valid JSON but not an object (null/array)
    return (art.get(status_field) if status_field else None), art


def render_verbatim(pairs) -> str:
    """Side-by-side full artifacts for a human quality read at the end of an A/B.

    pairs: list of (label, ctrl_slot, treat_slot) where a slot is the artifact dict,
    None (the run produced no artifact), or "BAD_JSON" (artifact present but
    unparseable — a different failure, rendered distinctly). Renders each input's
    control then treatment artifact as untruncated pretty JSON, in the given order, so
    the apples-to-apples comparison reads left-to-right. A missing arm is shown,
    never dropped.
    """
    out = ["# A/B verbatim artifacts — control (v1) vs treatment (v2)",
           "", "_Full, untruncated output per input. Read for quality parity._", ""]
    for label, ctrl, treat in pairs:
        out.append(f"## {label}")
        out.append("")
        for arm, art in (("control (v1)", ctrl), ("treatment (v2)", treat)):
            out.append(f"### {arm}")
            if art is None:
                out.append("_(no artifact produced)_")
            elif art == "BAD_JSON":
                out.append("_(artifact present but unparseable)_")
            else:
                out.append("```json")
                out.append(json.dumps(art, indent=2, ensure_ascii=False))
                out.append("```")
            out.append("")
    return "\n".join(out)


def _verbatim_slot(rm):
    """What render_verbatim shows for one arm of a run_metrics result: the artifact
    dict, the BAD_JSON marker, or None when the arm is unmapped / produced nothing."""
    if rm is None:
        return None
    status, _, art = rm
    return "BAD_JSON" if status == "BAD_JSON" else art


def run_metrics(bucket: str, exp: str, rid: str, status_field: str | None):
    """Pull one run's trace + artifact (each exactly one S3 fetch).

    Returns (status, metrics | None, artifact | None). Metrics is None while the trace
    hasn't landed (run still in flight); status and artifact are returned regardless so
    a pending run's artifact can still render in --verbatim. Status follows perf_gate
    semantics (see fetch_artifact) — the "ok" label for field-less experiments is
    applied at the display layer, not here."""
    status, art = fetch_artifact(bucket, exp, rid, status_field)
    trace = s3_text(bucket, f"{exp}/{rid}/logs/workspace/conversation.jsonl")
    if trace is None:
        return status, None, art
    return status, score(trace, [], None), art


def _pending(rm) -> bool:
    """True while an arm can't be scored: no runs-map row, or its trace hasn't landed."""
    return rm is None or rm[1] is None


def group_runs(rows: list[dict]) -> dict:
    """Group runs-map rows by label -> arm -> row. The map is hand-built, so a
    duplicate (label, arm) row is a mistake that would silently score the wrong
    run_id — reject it loudly instead of last-write-wins."""
    by: dict[str, dict] = {}
    for r in rows:
        arms = by.setdefault(r["label"], {})
        if r["arm"] in arms:
            raise ValueError(
                f"duplicate runs-map row for (label={r['label']!r}, arm={r['arm']!r}): "
                f"{arms[r['arm']]['run_id']} vs {r['run_id']}"
            )
        arms[r["arm"]] = r
    return by


def pct_delta(new: float, base: float) -> str:
    """Signed percent change of new vs base, 'n/a' when base is zero."""
    if not base:
        return "n/a"
    return f"{100 * (new - base) / base:+.0f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs_map", help="TSV: exp, arm(ctrl|treat), path, label, run_id (with header)")
    ap.add_argument("--bucket", default="gp-agent-artifacts-dev")
    ap.add_argument("--status-field", default="briefing_status",
                    help="artifact field holding the run outcome (empty string = none)")
    ap.add_argument("--verbatim", metavar="PATH",
                    help="also write a markdown of each input's FULL control-vs-treatment "
                         "artifact (untruncated) for a human quality read")
    a = ap.parse_args()
    status_field = a.status_field or None

    rows = list(csv.DictReader(open(a.runs_map), delimiter="\t"))
    by = group_runs(rows)
    order = list(dict.fromkeys(r["label"] for r in rows))

    hdr = (f'{"input":24s}{"v1$":>7s}{"v2$":>7s}{"$save":>7s}'
           f'{"v1t":>5s}{"v2t":>5s}{"tsave":>7s}{"v1pl%":>7s}{"v2pl%":>7s}  note')
    print(hdr)
    print("-" * len(hdr))
    cc = tc = ct = tt = npairs = 0
    verbatim_pairs = []
    for lbl in order:
        g = by.get(lbl, {})
        cm = run_metrics(a.bucket, g["ctrl"]["exp"], g["ctrl"]["run_id"], status_field) if "ctrl" in g else None
        tm = run_metrics(a.bucket, g["treat"]["exp"], g["treat"]["run_id"], status_field) if "treat" in g else None
        verbatim_pairs.append((lbl, _verbatim_slot(cm), _verbatim_slot(tm)))
        if _pending(cm) or _pending(tm):
            miss = ",".join(x for x, v in (("v1", cm), ("v2", tm)) if _pending(v))
            print(f'{lbl:24s}{"":>53s}  waiting ({miss})')
            continue
        cs, c, _ = cm
        ts, t, _ = tm
        if status_field is None:
            cs = "ok" if cs is None else cs
            ts = "ok" if ts is None else ts
        include, why = ab_pair_includable({**c, "status": cs}, {**t, "status": ts})
        if include and cs in (NO_ARTIFACT, "BAD_JSON"):
            include, why = False, f"no valid artifact: status={cs}"
        note = "" if include else f"{why} (excluded)"
        ds = c["cost"] - t["cost"]
        dt = (c["turns"] or 0) - (t["turns"] or 0)
        print(f'{lbl:24s}{c["cost"]:>7.2f}{t["cost"]:>7.2f}{ds:>+7.2f}'
              f'{str(c["turns"]):>5s}{str(t["turns"]):>5s}{dt:>+7d}'
              f'{c["planning_pct"]:>7.1f}{t["planning_pct"]:>7.1f}  {note}')
        if include:
            cc += c["cost"]; tc += t["cost"]; ct += c["turns"] or 0; tt += t["turns"] or 0; npairs += 1
    print("-" * len(hdr))
    if npairs:
        print(f'{f"CLEAN PAIRS ({npairs})":24s}{cc:>7.2f}{tc:>7.2f}{cc-tc:>+7.2f}'
              f'{ct:>5d}{tt:>5d}{ct-tt:>+7d}')
        print(f'\n  v2 vs v1 (clean pairs only):  cost {pct_delta(tc, cc)}   '
              f'turns {pct_delta(tt, ct)}   (negative = v2 saves)')
    else:
        print("  no outcome-matched pairs complete yet")

    if a.verbatim:
        with open(a.verbatim, "w") as f:
            f.write(render_verbatim(verbatim_pairs))
        print(f"\n  verbatim artifacts written to {a.verbatim}")


if __name__ == "__main__":
    main()
