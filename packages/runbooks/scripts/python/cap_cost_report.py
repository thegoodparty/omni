#!/usr/bin/env python3
"""Stage 7 — one self-contained, shareable HTML cost report.

Turns a cohort's analysis outputs (scope.json, plots/distributions.json,
profile.json, and the PNGs in plots/) into a SINGLE self-contained HTML file:
every PNG is embedded as a base64 data: URI and the CSS is inlined, so the file
has NO external URLs and renders offline. The print stylesheet makes the
browser's "Save as PDF" yield a clean document.

The report is DATA-DRIVEN: every number is read from the existing output JSONs,
nothing is hardcoded, so it works for any experiment_type / cohort. Sections
degrade gracefully when a field is absent — no profile.json, no milestone data,
a null headline, or non-standard outcome statuses all render rather than crash.

When the parquet is available, a small drivers block (cache_read share of
tokens, cost<->turns correlation, median/max turns per run) is computed inline
and drives the "where the cost goes" prose; it is optional and the section
falls back to a generic line when the parquet is absent.

Usage:
  cap_cost_report.py --exp-dir outputs/cap-cost/meeting_briefing
  cap_cost_report.py --exp-dir outputs/cap-cost/community_issues \
      --scope outputs/cap-cost/community_issues/scope_top.json \
      --plots outputs/cap-cost/community_issues/plots_top \
      --out outputs/cap-cost/community_issues/report_top.html
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import os
import sys
from datetime import datetime, timezone

# Status -> dot color. Standard CAP statuses map to the palette; anything else
# (non-standard or job-specific) falls back to neutral slate so unknown buckets
# still render with a dot rather than breaking.
SUCCESS_HINTS = ("ready", "complete", "completed", "success", "delivered")
FAILURE_HINTS = ("fail", "error", "crash", "no_artifact", "timeout")


def fmt_usd(v) -> str:
    if v is None:
        return "n/a"
    return f"${v:,.2f}"


def fmt_pct(v) -> str:
    if v is None:
        return "n/a"
    return f"{v:.1f}%"


def esc(v) -> str:
    return html.escape(str(v)) if v is not None else ""


def load_json(path: str | None) -> dict | None:
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def embed_png(path: str) -> str | None:
    """Read a PNG and return a data: URI, or None if it is missing."""
    if not path or not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def status_color(status: str, success_status: str | None) -> str:
    s = (status or "").lower()
    if success_status and status == success_status:
        return "var(--accent)"
    if any(h in s for h in SUCCESS_HINTS):
        return "var(--accent)"
    if any(h in s for h in FAILURE_HINTS):
        return "#9aa3af"
    # Placeholder / intermediate outcomes (e.g. awaiting_agenda) read as "miss".
    return "var(--warn)"


def compute_drivers(parquet_path: str | None) -> dict | None:
    """Optional cost-driver stats read straight from the turns parquet:
    cache_read share of tokens, per-run cost<->turn-count correlation, and the
    turn-count distribution. Returns None if the parquet is absent or unreadable
    so the report still renders. Kept here (not in cap_cost_analyze) so the
    report is self-sufficient and the analyze stage stays untouched."""
    if not parquet_path or not os.path.exists(parquet_path):
        return None
    try:
        import numpy as np
        import pandas as pd

        df = pd.read_parquet(parquet_path)
    except Exception as exc:
        print(f"warning: drivers block skipped — {exc}", file=sys.stderr)
        return None
    if df.empty:
        return None
    out: dict = {}
    if "cache_read" in df.columns and "tokens" in df.columns:
        total_tokens = float(df["tokens"].sum())
        if total_tokens > 0:
            out["cache_read_share"] = round(float(df["cache_read"].sum()) / total_tokens, 4)
    required_cols = {"run_id", "turn_idx", "run_cost_usd"}
    if not required_cols.issubset(df.columns):
        missing = required_cols - set(df.columns)
        print(
            f"warning: drivers block skipped — parquet missing columns: {missing}",
            file=sys.stderr,
        )
        return out or None
    per_run = (
        df.groupby("run_id")
        .agg(turns=("turn_idx", "count"), cost=("run_cost_usd", "first"))
        .reset_index()
    )
    if len(per_run) >= 2 and per_run["cost"].std() > 0 and per_run["turns"].std() > 0:
        out["cost_turns_corr"] = round(
            float(np.corrcoef(per_run["turns"], per_run["cost"])[0, 1]), 3
        )
    if not per_run.empty:
        out["median_turns"] = int(per_run["turns"].median())
        out["max_turns"] = int(per_run["turns"].max())
    return out or None


def build_metrics(scope: dict, profile: dict | None, dist: dict) -> list[dict]:
    """The 4-card metric row. Headline first (or total when no profile), then
    per-run, total, and delivered/total."""
    overall = dist.get("overall", {})
    summary = scope.get("summary", {})
    n_runs = summary.get("runs") or overall.get("n") or 0
    total = overall.get("total")
    if total is None:
        total = summary.get("costUsd_sum")

    cards: list[dict] = []
    headline = (profile or {}).get("headline") or {}
    success_status = (profile or {}).get("success_status")
    outcome_counts = (profile or {}).get("outcome_counts") or {}
    delivered = outcome_counts.get(success_status, 0) if success_status else None

    if headline:
        val = headline.get("value")
        if val is None:
            head_val = f"n/a ({delivered} delivered)" if delivered is not None else "n/a"
        else:
            head_val = fmt_usd(val)
        cards.append(
            {
                "lead": True,
                "val": head_val,
                "key": esc(headline.get("note"))
                or f"per {esc(success_status or 'successful')} run",
            }
        )
    elif total is not None:
        cards.append(
            {"lead": True, "val": fmt_usd(total), "key": "total cohort cost (invoice-validated)"}
        )

    per_run = (total / n_runs) if (total is not None and n_runs) else None
    cards.append({"val": fmt_usd(per_run), "key": "per dispatched run"})
    if headline:
        cards.append({"val": fmt_usd(total), "key": "total cohort cost (invoice-validated)"})

    if success_status and delivered is not None:
        cards.append(
            {
                "val": f"{delivered} / {n_runs}",
                "key": f"runs that reached {esc(success_status)}",
            }
        )
    else:
        cards.append({"val": str(n_runs), "key": "runs in scope"})
    return cards[:4]


def render(
    scope: dict,
    dist: dict,
    profile: dict | None,
    drivers: dict | None,
    images: dict[str, str | None],
) -> str:
    exp_type = scope.get("experiment_type", "unknown")
    summary = scope.get("summary", {})
    coverage = dist.get("coverage", {})
    overall = dist.get("overall", {})
    n_runs = summary.get("runs") or overall.get("n") or 0
    cov_pct = coverage.get("coverage_pct")
    win_start = summary.get("window_start_utc") or ""
    win_short = win_start[:16].replace("T", " ") if win_start else ""

    metrics = build_metrics(scope, profile, dist)
    success_status = (profile or {}).get("success_status")

    parts: list[str] = []
    parts.append('<div class="wrap">')

    # ---- header ----
    parts.append("<header>")
    parts.append('<p class="eyebrow">CAP agent cost analysis</p>')
    lead = metrics[0] if metrics else {}
    headline_val = lead.get("val", "")
    parts.append(
        f"<h1>{esc(exp_type)} cohort cost: "
        f'<span class="fig">{esc(headline_val)}</span></h1>'
    )
    parts.append(
        '<p class="lede">'
        f"The {esc(win_short or scope.get('label', 'recent'))} "
        f'<span class="fig">{esc(exp_type)}</span> cohort: '
        "where the spend goes, what it produced, and how it is distributed."
        "</p>"
    )
    meta_bits = [f"cohort {esc(win_short)}" if win_short else None]
    meta_bits.append(f"n={n_runs} runs")
    if cov_pct is not None:
        meta_bits.append(f"{fmt_pct(cov_pct)} log coverage")
    meta_bits.append("source: analyze-cap-agent-costs skill, prod read-only")
    parts.append(
        '<p class="meta-line">'
        + " &nbsp;/&nbsp; ".join(b for b in meta_bits if b)
        + "</p>"
    )
    parts.append("</header>")

    # ---- metric cards ----
    parts.append('<div class="metrics">')
    for m in metrics:
        cls = "metric lead" if m.get("lead") else "metric"
        parts.append(
            f'<div class="{cls}"><span class="val">{esc(m["val"])}</span>'
            f'<span class="key">{m["key"]}</span></div>'
        )
    parts.append("</div>")

    # ---- outcome mix ----
    outcome_counts = (profile or {}).get("outcome_counts")
    if outcome_counts:
        parts.append("<section>")
        parts.append("<h2>What the cohort produced</h2>")
        parts.append(
            '<p class="section-note">'
            f"{n_runs} runs were dispatched. Outcomes are bucketed from each run's "
            "S3 artifact (the DB-FAILED runs and any missing artifacts are bucketed too). "
            "Cost is amortized over every dispatched run, so misses are paid for."
            "</p>"
        )
        parts.append('<div class="tbl-wrap"><table><thead><tr>')
        parts.append(
            "<th>Outcome</th><th class='num'>Runs</th><th class='num'>Share</th></tr></thead><tbody>"
        )
        total_count = sum(outcome_counts.values()) or 1
        for status, count in sorted(outcome_counts.items(), key=lambda kv: -kv[1]):
            color = status_color(status, success_status)
            share = 100 * count / total_count
            parts.append(
                "<tr><td>"
                f'<span class="status-dot" style="background: {color}"></span>{esc(status)}'
                f'</td><td class="num">{count}</td>'
                f'<td class="num">{share:.1f}%</td></tr>'
            )
        parts.append("</tbody></table></div>")
        parts.append("</section>")

    # ---- where the money goes ----
    parts.append("<section>")
    parts.append("<h2>Where the money goes</h2>")
    if drivers and drivers.get("cache_read_share") is not None:
        cache_pct = drivers["cache_read_share"] * 100
        corr = drivers.get("cost_turns_corr")
        med_turns = drivers.get("median_turns")
        max_turns = drivers.get("max_turns")
        parts.append(
            '<p class="section-note">'
            "Cost is not concentrated in one expensive step. It is spread across the "
            "run, because the agent re-reads its accumulated context every turn."
            "</p>"
        )
        sentence = (
            f'Cached-context reads are <span class="fig fig-accent">{cache_pct:.1f}%</span> '
            "of all tokens."
        )
        if corr is not None:
            sentence += (
                f' Per-run cost correlates with turn count at <span class="fig">r = {corr}</span>'
            )
            if med_turns is not None:
                sentence += (
                    f' (median <span class="fig">{med_turns}</span> turns per run'
                    + (f", up to {max_turns}" if max_turns is not None else "")
                    + ")"
                )
            sentence += "."
        sentence += (
            ' In short, cost is <span class="fig">cache_read x turns</span>, and the lever is '
            "fewer turns, not a single hot phase."
        )
        parts.append(f"<p>{sentence}</p>")
    else:
        parts.append(
            '<p class="section-note">'
            "Cost accumulates across the run as the agent re-reads its growing context "
            "each turn. See the lifecycle charts below for where within a run the spend lands."
            "</p>"
        )
    parts.append("</section>")

    # ---- distribution ----
    parts.append("<section>")
    parts.append("<h2>Cost distribution</h2>")
    parts.append(
        '<p class="section-note">'
        "Per-run cost spread across the cohort. A flat distribution means there is no "
        "small set of runaway runs to target; a heavy tail means a few runs drive the bill."
        "</p>"
    )
    parts.append('<div class="tbl-wrap"><table><thead><tr>')
    parts.append("<th>Statistic</th><th class='num'>Per-run cost</th></tr></thead><tbody>")
    for label, key in [("Median", "median"), ("p90", "p90"), ("p99", "p99"), ("Max", "max")]:
        val = overall.get(key)
        parts.append(
            f"<tr><td>{label}</td><td class='num'>{fmt_usd(val)}</td></tr>"
        )
    parts.append("</tbody></table></div>")

    pareto = dist.get("pareto_tail")
    if pareto and pareto.get("of_total_runs"):
        n80 = pareto.get("runs_driving_80pct_spend")
        of_total = pareto.get("of_total_runs")
        share = pareto.get("share_of_runs")
        share_txt = f"{share * 100:.0f}%" if share is not None else "n/a"
        heavy = (share is not None and share < 0.35)
        verdict = (
            "A handful of runs drive the bill, so outlier-hunting pays off."
            if heavy
            else "Spend is spread broadly, so per-run reduction beats outlier-hunting."
        )
        parts.append('<div class="callout"><h3>Pareto check</h3>')
        parts.append(
            f"<p>It takes <b>{esc(n80)} of {esc(of_total)} runs ({share_txt})</b> to account for 80% "
            f"of spend. {verdict}</p></div>"
        )
    parts.append("</section>")

    # ---- milestone attribution (only when present) ----
    milestone = dist.get("milestone_costs")
    if milestone and milestone.get("ordered"):
        parts.append("<section>")
        parts.append("<h2>Where the cost lands by milestone</h2>")
        note = dist.get("milestone_note", "")
        if note:
            parts.append(f'<p class="section-note">{esc(note)}</p>')
        parts.append('<div class="tbl-wrap"><table><thead><tr>')
        parts.append(
            "<th>Milestone</th><th class='num'>Total</th><th class='num'>Share</th>"
            "<th class='num'>Median / run</th></tr></thead><tbody>"
        )
        for row in milestone["ordered"]:
            share = row.get("share_of_spend")
            share_txt = f"{share * 100:.1f}%" if share is not None else "n/a"
            parts.append(
                f"<tr><td>{esc(row.get('milestone'))}</td>"
                f"<td class='num'>{fmt_usd(row.get('total'))}</td>"
                f"<td class='num'>{share_txt}</td>"
                f"<td class='num'>{fmt_usd(row.get('median_per_run'))}</td></tr>"
            )
        parts.append("</tbody></table></div>")
        parts.append("</section>")

    # ---- charts ----
    chart_specs = [
        (
            "cumulative_cost.png",
            "Cumulative cost by turn.",
            "Each line is one run. Spend rises with turn count, so the costliest runs "
            "tend to be the longest ones — the signature of paying cache-read on a "
            "growing context every turn.",
        ),
        (
            "cost_velocity.png",
            "Cost velocity, top runs.",
            "Dollars per turn for the costliest runs, with each run's peak annotated by "
            "the tool call on that turn. Use it to spot whether a single tool or step "
            "dominates per-turn spend.",
        ),
        (
            "population_heatmap.png",
            "Population heatmap.",
            "One row per run; color is cost intensity. The x-axis is the ordered "
            "milestone when markers are present, else normalized turn progress. Even "
            "shading across the width means no concentrated hot phase.",
        ),
        (
            "milestone_heatmap.png",
            "Milestone heatmap.",
            "Per-run cost keyed on the ordered milestone, for the runs that carry markers.",
        ),
        (
            "turn_progress_heatmap.png",
            "Turn-progress heatmap (full population).",
            "Full-cohort fallback view keyed on normalized turn progress, including runs "
            "without milestone markers.",
        ),
    ]
    rendered_figs = [
        (uri, title, cap)
        for name, title, cap in chart_specs
        for uri in [images.get(name)]
        if uri
    ]
    if rendered_figs:
        parts.append("<section>")
        parts.append("<h2>Cost over the run lifecycle</h2>")
        parts.append(
            '<p class="section-note">'
            "Three views of where spend lands within a run: cumulative cost by turn, "
            "per-turn velocity for the costliest runs, and a population heatmap."
            "</p>"
        )
        for uri, title, cap in rendered_figs:
            parts.append(
                f'<figure><img src="{uri}" alt="{esc(title)}" />'
                f"<figcaption><b>{esc(title)}</b> {cap}</figcaption></figure>"
            )
        parts.append("</section>")

    # ---- method and trust ----
    parts.append("<section>")
    parts.append("<h2>Method and trust</h2>")
    parts.append('<p class="section-note">The cost figures come from one source only.</p>')
    parts.append(
        "<p>Every dollar here is the recorded "
        '<span class="fig">experiment_run.costUsd</span>, which is invoice-validated: '
        "summing it over a full UTC day has matched the billed Anthropic amount to within "
        '<span class="fig">~2%</span>. Per-turn figures distribute that trusted total across '
        "a run's turns by token weight. Token counts are never multiplied by list price, "
        "which overshoots actual spend.</p>"
    )
    parts.append("</section>")

    # ---- footer ----
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    caveats: list[str] = []
    if not (drivers and drivers.get("cache_read_share") is not None):
        caveats.append("cost-driver stats (parquet absent or unreadable)")
    if dist.get("milestone_costs") is None:
        mcov = coverage.get("milestone_coverage_pct")
        if mcov is not None:
            caveats.append(
                f"per-milestone attribution (milestone coverage {fmt_pct(mcov)}, "
                "turn-progress path used)"
            )
        else:
            caveats.append("per-milestone attribution (no milestone markers)")
    if profile is None:
        caveats.append("outcome bucketing / headline metric (no profile.json)")
    caveat_line = ("<b>Not run:</b> " + "; ".join(caveats) + ".") if caveats else ""
    parts.append("<footer>")
    parts.append(
        f"<b>Generated</b> {generated} from the analyze-cap-agent-costs skill "
        f"(scope {esc(scope.get('label', exp_type))}), prod read-only, no spend incurred.<br />"
        + caveat_line
    )
    parts.append("</footer>")

    parts.append("</div>")
    return CSS + "\n" + "\n".join(parts)


CSS = """<style>
  :root {
    --ink: #16191f;
    --paper: #f5f6f8;
    --card: #ffffff;
    --slate: #56606e;
    --slate-soft: #7c8694;
    --line: #e4e7ec;
    --accent: #0f6e63;
    --accent-soft: #e6f1ef;
    --warn: #b45309;
    --warn-soft: #f7efe3;
    --fs-eyebrow: 0.72rem;
    --mono:
      ui-monospace, "SF Mono", "SFMono-Regular", Menlo, "Cascadia Mono",
      "Roboto Mono", monospace;
    --sans:
      system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
      sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  .wrap {
    max-width: 840px;
    margin: 0 auto;
    padding: 64px 32px 96px;
  }

  .eyebrow {
    font-size: var(--fs-eyebrow);
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 600;
    margin: 0 0 14px;
  }

  h1 {
    font-size: clamp(1.9rem, 4.5vw, 2.5rem);
    line-height: 1.12;
    letter-spacing: -0.018em;
    text-wrap: balance;
    margin: 0 0 16px;
    font-weight: 680;
  }

  .lede {
    font-size: 1.05rem;
    color: var(--slate);
    max-width: 64ch;
    margin: 0 0 8px;
  }

  .meta-line {
    font-family: var(--mono);
    font-size: 0.82rem;
    color: var(--slate-soft);
    margin-top: 18px;
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }

  section {
    margin-top: 56px;
  }

  h2 {
    font-size: 1.18rem;
    letter-spacing: -0.01em;
    margin: 0 0 6px;
    font-weight: 640;
  }

  .section-note {
    color: var(--slate);
    font-size: 0.95rem;
    margin: 0 0 22px;
    max-width: 66ch;
  }

  p {
    max-width: 66ch;
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    margin-top: 36px;
  }
  .metric {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 18px 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .metric .val {
    font-family: var(--mono);
    font-size: 1.62rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .metric.lead .val {
    color: var(--accent);
  }
  .metric .key {
    font-size: 0.78rem;
    color: var(--slate);
    line-height: 1.35;
  }

  .tbl-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: right;
    padding: 9px 14px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    white-space: normal;
  }
  thead th {
    font-size: var(--fs-eyebrow);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--slate);
    font-weight: 600;
    border-bottom: 1.5px solid var(--ink);
  }
  td.num,
  th.num {
    font-family: var(--mono);
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 9px;
    vertical-align: middle;
  }

  .fig {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .fig-accent {
    color: var(--accent);
  }
  .fig-warn {
    color: var(--warn);
  }

  figure {
    margin: 26px 0 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 16px;
  }
  figure img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 4px;
  }
  figcaption {
    font-size: 0.84rem;
    color: var(--slate);
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  figcaption b {
    color: var(--ink);
    font-weight: 600;
  }

  .callout {
    background: var(--accent-soft);
    border: 1px solid #cfe4e0;
    border-radius: 10px;
    padding: 20px 22px;
    margin-top: 28px;
  }
  .callout h3 {
    margin: 0 0 8px;
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 600;
  }
  .callout p {
    margin: 0;
    font-size: 0.94rem;
    color: #1c4a44;
    max-width: none;
  }

  .takeaway {
    border-left: 3px solid var(--accent);
    padding: 4px 0 4px 22px;
    margin-top: 26px;
  }
  .takeaway p {
    font-size: 1.04rem;
  }

  footer {
    margin-top: 64px;
    border-top: 1px solid var(--line);
    padding-top: 18px;
    font-family: var(--mono);
    font-size: 0.76rem;
    color: var(--slate-soft);
    line-height: 1.7;
  }
  footer b {
    color: var(--slate);
    font-weight: 600;
  }

  a {
    color: var(--accent);
  }

  @media (max-width: 680px) {
    .metrics {
      grid-template-columns: repeat(2, 1fr);
    }
    .wrap {
      padding: 40px 20px 64px;
    }
  }

  @media print {
    :root {
      --paper: #ffffff;
    }
    body {
      font-size: 11.5pt;
    }
    .wrap {
      max-width: none;
      padding: 0;
    }
    @page {
      margin: 16mm 14mm;
    }
    section {
      margin-top: 30px;
    }
    figure,
    .metric,
    .callout,
    table,
    .takeaway {
      break-inside: avoid;
    }
    .metrics {
      gap: 10px;
    }
    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>"""


def build_report(
    scope_path: str,
    plots_dir: str,
    profile_path: str | None,
    parquet_path: str | None,
) -> str:
    """Assemble the full self-contained HTML string (CSS + body, ready to wrap
    in <html>/<body>). Pure given its file inputs — the test drives this."""
    scope = load_json(scope_path)
    if not scope:
        raise SystemExit(f"scope JSON not found / empty: {scope_path}")
    dist = load_json(os.path.join(plots_dir, "distributions.json")) or {}
    profile = load_json(profile_path)
    drivers = compute_drivers(parquet_path)
    images = {
        name: embed_png(os.path.join(plots_dir, name))
        for name in (
            "cumulative_cost.png",
            "cost_velocity.png",
            "population_heatmap.png",
            "milestone_heatmap.png",
            "turn_progress_heatmap.png",
        )
    }
    exp_type = scope.get("experiment_type", "report")
    title = f"{exp_type} cohort cost report"
    body = render(scope, dist, profile, drivers, images)
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n"
        '<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        f"<title>{html.escape(title)}</title>\n</head>\n<body>\n"
        f"{body}\n</body>\n</html>\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Stage 7 — self-contained HTML cost report.")
    ap.add_argument(
        "--exp-dir",
        help="experiment output dir (outputs/cap-cost/<exp>); defaults paths for "
        "scope.json, plots/, profile.json, turns.parquet, report.html",
    )
    ap.add_argument("--scope", help="scope JSON (default <exp-dir>/scope.json)")
    ap.add_argument("--plots", help="plots dir holding distributions.json + PNGs")
    ap.add_argument("--profile", help="profile.json (optional)")
    ap.add_argument("--turns", help="turns.parquet for the optional drivers block")
    ap.add_argument("--out", help="output HTML path (default <exp-dir>/report.html)")
    a = ap.parse_args()

    exp_dir = a.exp_dir
    scope_path = a.scope or (os.path.join(exp_dir, "scope.json") if exp_dir else None)
    if not scope_path:
        raise SystemExit("provide --scope or --exp-dir")
    plots_dir = a.plots or (os.path.join(exp_dir, "plots") if exp_dir else None)
    if not plots_dir:
        raise SystemExit("provide --plots or --exp-dir")
    profile_path = a.profile or (
        os.path.join(exp_dir, "profile.json") if exp_dir else None
    )
    parquet_path = a.turns or (
        os.path.join(exp_dir, "turns.parquet") if exp_dir else None
    )
    out = a.out or (os.path.join(exp_dir, "report.html") if exp_dir else None)
    if not out:
        raise SystemExit("provide --out or --exp-dir")

    doc = build_report(scope_path, plots_dir, profile_path, parquet_path)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as f:
        f.write(doc)
    size_kb = round(len(doc.encode("utf-8")) / 1024, 1)
    print(f"wrote {out} ({size_kb} KB, self-contained)")


if __name__ == "__main__":
    main()
