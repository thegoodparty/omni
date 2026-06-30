#!/usr/bin/env python3
"""Stage 4 — hot-region detector + agent labeler.

Detect POPULATION-level hot regions: normalized turn-progress bands that carry
outsized cost across the whole cohort (not one run). Then slice ONLY those turn
rows and ask the Anthropic SDK to label "what kind of work is expensive here,"
feeding the model a small summary of the hot slice (tool-call mix, token mix) —
never the full cohort.

When the cohort has milestone markers (written by the agent via
pmf_runtime.milestone(), tagged onto turn rows upstream), regions are NAMED
MILESTONES: a milestone is "hot" when its share of total cost exceeds an even
split across milestones by a margin. When no markers are present, it falls back
to normalized turn-progress bands: a band is "hot" when its share exceeds its
uniform share (1/bins) by a margin (default 1.5x).

Usage:
  cap_cost_hotspots.py --turns outputs/cap-cost/meeting_briefing/turns.parquet
  # add --label to call the Anthropic SDK (needs ANTHROPIC_API_KEY); omit for detect-only
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd


def band_of(df: pd.DataFrame, bins: int) -> pd.Series:
    """Normalized-turn-progress band index per turn row, per run."""
    out = pd.Series(0, index=df.index, dtype=int)
    for run_id, g in df.groupby("run_id"):
        n = len(g)
        if n <= 1:
            out.loc[g.index] = 0
            continue
        prog = g["turn_idx"].to_numpy() / (n - 1)
        out.loc[g.index] = np.clip((prog * (bins - 1)).round().astype(int), 0, bins - 1)
    return out


def detect_hot_regions(df: pd.DataFrame, bins: int = 10, margin: float = 1.5) -> list[dict]:
    df = df.copy()
    df["band"] = band_of(df, bins)
    total = df["est_cost"].sum()
    uniform_share = 1.0 / bins
    regions = []
    for band, g in df.groupby("band"):
        share = (g["est_cost"].sum() / total) if total else 0.0
        if share >= uniform_share * margin:
            tool_mix = (
                pd.Series(
                    [t for row in g["tool_calls"].fillna("") for t in row.split(",") if t]
                )
                .value_counts()
                .head(8)
                .to_dict()
            )
            regions.append(
                {
                    "band": int(band),
                    "progress_range": [round(band / bins, 2), round((band + 1) / bins, 2)],
                    "cost_share": round(float(share), 3),
                    "cost_total": round(float(g["est_cost"].sum()), 2),
                    "turn_rows": int(len(g)),
                    "mean_cache_read": int(g["cache_read"].mean()),
                    "mean_tokens": int(g["tokens"].mean()),
                    "top_tools": tool_mix,
                }
            )
    return sorted(regions, key=lambda r: -r["cost_share"])


def has_milestones(df: pd.DataFrame) -> bool:
    return "milestone" in df.columns and df["milestone"].notna().any()


def detect_hot_milestones(df: pd.DataFrame, margin: float = 1.5) -> list[dict]:
    """Hot NAMED milestones: a milestone whose cost share exceeds an even split
    across the present milestones by `margin`. Only over turns that carry a
    marker. Ordered by run-sequence (mean turn position)."""
    m = df[df["milestone"].notna()].copy()
    total_marked = m["est_cost"].sum()
    total_cohort = df["est_cost"].sum()
    names = m.groupby("milestone")["turn_idx"].mean().sort_values().index.tolist()
    uniform_share = 1.0 / len(names) if names else 0.0
    regions = []
    for order_idx, name in enumerate(names):
        g = m[m["milestone"] == name]
        seg = g["est_cost"].sum()
        # Hotness is measured AMONG milestones (disproportion vs an even split),
        # so compare against marked spend; but report cost_share as a fraction of
        # TOTAL cohort spend to stay consistent with milestone_costs.
        share_among = (seg / total_marked) if total_marked else 0.0
        if share_among >= uniform_share * margin:
            tool_mix = (
                pd.Series(
                    [t for row in g["tool_calls"].fillna("") for t in row.split(",") if t]
                )
                .value_counts()
                .head(8)
                .to_dict()
            )
            regions.append(
                {
                    "milestone": name,
                    "order": order_idx,
                    "cost_share": round(float(seg / total_cohort), 3) if total_cohort else 0.0,
                    "share_among_milestones": round(float(share_among), 3),
                    "cost_total": round(float(seg), 2),
                    "turn_rows": int(len(g)),
                    "runs": int(g["run_id"].nunique()),
                    "mean_cache_read": int(g["cache_read"].mean()),
                    "mean_tokens": int(g["tokens"].mean()),
                    "top_tools": tool_mix,
                }
            )
    return sorted(regions, key=lambda r: -r["cost_share"])


def label_regions(experiment_type: str, regions: list[dict], by_milestone: bool = False) -> str:
    """Ask the Anthropic SDK what kind of work is expensive in the hot slices.
    Small prompt; only the hot-slice summaries are fed in."""
    import anthropic

    client = anthropic.Anthropic()
    region_kind = "named milestones" if by_milestone else "turn-progress bands"
    prompt = (
        f"You are analyzing the cost profile of a CAP agent experiment of type "
        f"'{experiment_type}'. Below are the cohort's HOT {region_kind} (the ones "
        f"carrying outsized cost), each with its tool-call mix and token mix. "
        f"For each, in one sentence, name what kind of work is expensive there "
        f"and the likely driver. Be concrete and terse.\n\n"
        f"These are {region_kind}.\n\n"
        f"{json.dumps(regions, indent=2)}"
    )
    msg = client.messages.create(
        model=os.environ.get("CAP_COST_LABEL_MODEL", "claude-sonnet-4-6"),
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


def main() -> None:
    ap = argparse.ArgumentParser(description="Detect population hot regions and optionally label them.")
    ap.add_argument("--turns", required=True)
    ap.add_argument("--bins", type=int, default=10)
    ap.add_argument("--margin", type=float, default=1.5)
    ap.add_argument("--label", action="store_true", help="call the Anthropic SDK to label hot slices")
    ap.add_argument("--out")
    a = ap.parse_args()

    df = pd.read_parquet(a.turns)
    if df.empty:
        raise SystemExit("turns parquet is empty")
    exp_type = df["experiment_type"].iloc[0]
    by_milestone = has_milestones(df)
    if by_milestone:
        regions = detect_hot_milestones(df, margin=a.margin)
    else:
        regions = detect_hot_regions(df, bins=a.bins, margin=a.margin)
    result = {
        "experiment_type": exp_type,
        "region_kind": "milestone" if by_milestone else "turn_band",
        "bins": a.bins,
        "hot_regions": regions,
    }
    if a.label and regions:
        result["labels"] = label_regions(exp_type, regions, by_milestone=by_milestone)

    out = a.out or f"outputs/cap-cost/{exp_type}/hotspots.json"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
