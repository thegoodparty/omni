#!/usr/bin/env python3
"""Stage 3 — analytics + plots over the cached per-turn parquet.

Reads turns.parquet (cap_cost_extract.py) and the scope JSON. Reports
DISTRIBUTIONS, not point estimates: median / p90 / p99 / max plus the Pareto
tail (which runs drive the bulk of spend), per status. Emits plots:

  - per-run cumulative cost curves (one line per run, $ vs turn)
  - cost-velocity (d$/dturn) with each spike annotated by the tool call on that turn
  - population heatmap: one ROW per run, X = ORDERED MILESTONE when markers are
    present (else NORMALIZED turn progress 0..1), color = cost intensity.

When the cohort has milestone markers (written by the agent via
pmf_runtime.milestone(), tagged onto each turn row upstream), this also emits a
per-milestone cost attribution table and keys the population heatmap on the
ordered milestone column. When no run has markers (older cohorts), it falls back
to turn-level analysis and a turn-progress heatmap, exactly as before.

All dollar figures trace back to experiment_run.costUsd (distributed across turns
by token weight upstream) — never token-count x list price.

Usage:
  cap_cost_analyze.py --turns outputs/cap-cost/meeting_briefing/turns.parquet \
      --outdir outputs/cap-cost/meeting_briefing/plots
"""
from __future__ import annotations

import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


def pct(series: pd.Series, p: float) -> float:
    vals = [v for v in series.tolist() if v is not None]
    if not vals:
        return 0.0
    return float(np.percentile(vals, p))


def run_costs(df: pd.DataFrame) -> pd.DataFrame:
    """Per-run total cost (the trusted run_cost_usd, one value per run)."""
    return (
        df.groupby(["run_id", "status"])
        .agg(run_cost=("run_cost_usd", "first"), turns=("turn_idx", "count"))
        .reset_index()
    )


def distribution_tables(df: pd.DataFrame) -> dict:
    rc = run_costs(df)
    out = {"overall": {}, "by_status": {}, "pareto_tail": {}}
    for label, sub in [("overall", rc)] + [(f"status:{s}", g) for s, g in rc.groupby("status")]:
        costs = sub["run_cost"]
        block = {
            "n": int(len(sub)),
            "total": round(float(costs.sum()), 2),
            "median": round(pct(costs, 50), 4),
            "p90": round(pct(costs, 90), 4),
            "p99": round(pct(costs, 99), 4),
            "max": round(float(costs.max()) if len(costs) else 0.0, 4),
        }
        if label == "overall":
            out["overall"] = block
        else:
            out["by_status"][label.split(":", 1)[1]] = block
    # Pareto tail: what share of runs drives the top 80% of spend.
    ordered = rc.sort_values("run_cost", ascending=False).reset_index(drop=True)
    total = ordered["run_cost"].sum()
    if total > 0:
        cum = ordered["run_cost"].cumsum() / total
        n80 = int((cum < 0.80).sum()) + 1
        out["pareto_tail"] = {
            "runs_driving_80pct_spend": min(n80, len(ordered)),
            "of_total_runs": int(len(ordered)),
            "share_of_runs": round(min(n80, len(ordered)) / len(ordered), 3),
            "top_runs": ordered.head(min(n80, len(ordered)))[["run_id", "run_cost"]].to_dict(
                orient="records"
            ),
        }
    return out


def has_milestones(df: pd.DataFrame) -> bool:
    """True when any turn row carries a milestone marker. The column may be
    absent on parquet written before the primitive shipped."""
    return "milestone" in df.columns and df["milestone"].notna().any()


def milestone_order(df: pd.DataFrame) -> list[str]:
    """Milestones ordered by first appearance (mean turn position across runs),
    so the heatmap and table read in run-sequence order rather than alphabetically."""
    m = df[df["milestone"].notna()]
    if m.empty:
        return []
    first_pos = m.groupby("milestone")["turn_idx"].mean().sort_values()
    return first_pos.index.tolist()


def milestone_costs(df: pd.DataFrame) -> dict:
    """Per-milestone cost attribution: total / median-per-run / share of spend,
    in run-sequence order. Only over turns that carry a marker (null-milestone
    turns from mixed cohorts are excluded from the per-milestone view)."""
    m = df[df["milestone"].notna()]
    order = milestone_order(df)
    total = float(df["est_cost"].sum())
    per_run = m.groupby(["run_id", "milestone"])["est_cost"].sum().reset_index()
    rows = []
    for name in order:
        seg = per_run[per_run["milestone"] == name]["est_cost"]
        seg_total = float(seg.sum())
        rows.append(
            {
                "milestone": name,
                "total": round(seg_total, 2),
                "share_of_spend": round(seg_total / total, 3) if total else 0.0,
                "runs": int(seg.shape[0]),
                "median_per_run": round(float(np.median(seg)) if len(seg) else 0.0, 4),
                "p90_per_run": round(pct(seg, 90), 4),
            }
        )
    return {"ordered": rows, "runs_with_milestones": int(m["run_id"].nunique())}


def plot_milestone_heatmap(df: pd.DataFrame, path: str) -> None:
    """One row per run that has markers; X = ordered milestone, color = $ in that
    milestone. Runs with no markers are omitted (they appear in the turn-progress
    heatmap fallback instead)."""
    order = milestone_order(df)
    m = df[df["milestone"].notna()]
    runs = sorted(m["run_id"].unique())
    col = {name: i for i, name in enumerate(order)}
    grid = np.zeros((len(runs), len(order)))
    for i, run_id in enumerate(runs):
        g = m[m["run_id"] == run_id]
        for name, cost in g.groupby("milestone")["est_cost"].sum().items():
            grid[i, col[name]] += float(cost)
    fig, ax = plt.subplots(figsize=(max(8, len(order) * 1.2), max(4, len(runs) * 0.12)))
    sns.heatmap(grid, cmap="rocket_r", cbar_kws={"label": "$ in milestone"}, ax=ax)
    ax.set_xticks(np.arange(len(order)) + 0.5)
    ax.set_xticklabels(order, rotation=40, ha="right", fontsize=8)
    ax.set_xlabel("milestone (run order)")
    ax.set_ylabel("run")
    ax.set_yticks([])
    ax.set_title(f"population cost heatmap by milestone ({len(runs)} runs)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_cumulative_curves(df: pd.DataFrame, path: str) -> None:
    fig, ax = plt.subplots(figsize=(10, 6))
    for run_id, g in df.sort_values("turn_idx").groupby("run_id"):
        cum = g["est_cost"].cumsum()
        ax.plot(g["turn_idx"], cum, alpha=0.35, linewidth=0.8)
    ax.set_xlabel("turn")
    ax.set_ylabel("cumulative $ (costUsd distributed by token weight)")
    ax.set_title(f"per-run cumulative cost ({df['run_id'].nunique()} runs)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_cost_velocity(df: pd.DataFrame, path: str, top_runs: int = 5) -> None:
    """d$/dturn for the costliest runs, each spike annotated with its tool call."""
    rc = run_costs(df).sort_values("run_cost", ascending=False)
    pick = rc["run_id"].head(top_runs).tolist()
    fig, ax = plt.subplots(figsize=(11, 6))
    for run_id in pick:
        g = df[df["run_id"] == run_id].sort_values("turn_idx")
        ax.plot(g["turn_idx"], g["est_cost"], alpha=0.7, linewidth=1.0, label=run_id[:8])
        if not g.empty:
            spike = g.loc[g["est_cost"].idxmax()]
            tool = (spike["tool_calls"] or "").split(",")[0] or "(no tool_use)"
            ax.annotate(
                tool,
                (spike["turn_idx"], spike["est_cost"]),
                fontsize=7,
                xytext=(0, 6),
                textcoords="offset points",
            )
    ax.set_xlabel("turn")
    ax.set_ylabel("$ per turn")
    ax.set_title(f"cost velocity, top {len(pick)} runs (spike labeled by turn's tool call)")
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_population_heatmap(df: pd.DataFrame, path: str, bins: int = 20) -> None:
    """One row per run; X = normalized turn progress (0..1), color = cost intensity.
    The turn-progress fallback used when a cohort has no milestone markers."""
    runs = sorted(df["run_id"].unique())
    grid = np.zeros((len(runs), bins))
    for i, run_id in enumerate(runs):
        g = df[df["run_id"] == run_id].sort_values("turn_idx")
        n = len(g)
        if n == 0:
            continue
        prog = (g["turn_idx"].to_numpy() / max(1, n - 1)) if n > 1 else np.array([0.0])
        idx = np.clip((prog * (bins - 1)).round().astype(int), 0, bins - 1)
        for b, cost in zip(idx, g["est_cost"].to_numpy()):
            grid[i, b] += cost
    fig, ax = plt.subplots(figsize=(11, max(4, len(runs) * 0.12)))
    sns.heatmap(grid, cmap="rocket_r", cbar_kws={"label": "$ in band"}, ax=ax)
    ax.set_xlabel("normalized turn progress (0..1) — no milestone markers in cohort")
    ax.set_ylabel("run")
    ax.set_yticks([])
    ax.set_title(f"population cost heatmap ({len(runs)} runs)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser(description="Analytics + plots over the per-turn parquet.")
    ap.add_argument("--turns", required=True, help="turns.parquet from cap_cost_extract.py")
    ap.add_argument("--outdir", help="plot + tables output dir")
    a = ap.parse_args()

    df = pd.read_parquet(a.turns)
    if df.empty:
        raise SystemExit("turns parquet is empty — nothing to analyze")
    exp_type = df["experiment_type"].iloc[0]
    outdir = a.outdir or f"outputs/cap-cost/{exp_type}/plots"
    os.makedirs(outdir, exist_ok=True)

    tables = distribution_tables(df)
    cov_path = os.path.splitext(a.turns)[0] + ".coverage.json"
    if os.path.exists(cov_path):
        with open(cov_path) as f:
            tables["coverage"] = json.load(f)

    milestones_present = has_milestones(df)
    if milestones_present:
        tables["milestone_costs"] = milestone_costs(df)
        tables["milestone_note"] = (
            "Per-milestone cost attribution is LIVE — markers present. Heatmap keyed "
            "on ordered milestone; runs without markers (if any) appear only in the "
            "turn-progress fallback heatmap."
        )
    else:
        tables["milestone_note"] = (
            "No milestone markers in this cohort (pre-primitive runs or agents that "
            "emitted none) — analysis is turn-level and the heatmap is keyed on "
            "normalized turn progress."
        )
    with open(os.path.join(outdir, "distributions.json"), "w") as f:
        json.dump(tables, f, indent=2)
    print(json.dumps(tables, indent=2))

    plot_cumulative_curves(df, os.path.join(outdir, "cumulative_cost.png"))
    plot_cost_velocity(df, os.path.join(outdir, "cost_velocity.png"))
    if milestones_present:
        plot_milestone_heatmap(df, os.path.join(outdir, "population_heatmap.png"))
    else:
        plot_population_heatmap(df, os.path.join(outdir, "population_heatmap.png"))
    print(f"wrote plots + distributions.json to {outdir}")


if __name__ == "__main__":
    main()
