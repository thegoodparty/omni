#!/usr/bin/env python3
"""Stage 4 — hot-region detector + agent labeler.

Detect POPULATION-level hot regions: normalized turn-progress bands that carry
outsized cost across the whole cohort (not one run). Then slice ONLY those turn
rows and ask the Anthropic SDK to label "what kind of work is expensive here,"
feeding the model a small summary of the hot slice (tool-call mix, token mix) —
never the full cohort.

Regions are turn-progress bands, NOT milestones (the milestone() primitive does
not exist yet — see SKILL.md). A band is "hot" when its share of total cost
exceeds its uniform share by a margin (default 1.5x of 1/bins).

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


def label_regions(experiment_type: str, regions: list[dict]) -> str:
    """Ask the Anthropic SDK what kind of work is expensive in the hot slices.
    Small prompt; only the hot-slice summaries are fed in."""
    import anthropic

    client = anthropic.Anthropic()
    prompt = (
        f"You are analyzing the cost profile of a CAP agent experiment of type "
        f"'{experiment_type}'. Below are the cohort's HOT turn-progress bands (the "
        f"bands carrying outsized cost), each with its tool-call mix and token mix. "
        f"For each band, in one sentence, name what kind of work is expensive there "
        f"and the likely driver. Be concrete and terse.\n\n"
        f"Note: these are turn-progress bands, not named milestones.\n\n"
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
    regions = detect_hot_regions(df, bins=a.bins, margin=a.margin)
    result = {"experiment_type": exp_type, "bins": a.bins, "hot_regions": regions}
    if a.label and regions:
        result["labels"] = label_regions(exp_type, regions)

    out = a.out or f"outputs/cap-cost/{exp_type}/hotspots.json"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
