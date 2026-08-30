---
name: analyze-cap-agent-costs
description: Use when you need to analyze the cost of CAP agent experiment runs or cohorts (meeting_briefing, community_issues, etc.) — what a job costs, where in a run the spend happens, which runs drive the bulk of spend, and how cost scales with district size. Resolves a scope from plain English, extracts per-turn cost-weighted data to a cached parquet, and produces cost-distribution tables and plots. Population-not-sample, distributions-not-point-estimates, and dollars always traced to the invoice-validated DB costUsd.
---

# Analyze CAP agent experiment costs

A generic cost-analysis pipeline over CAP background-agent experiment runs. Drives
the `cap_cost_*` Python modules in `packages/runbooks/scripts/python/` (uv project).
Run it to answer "what does an X job cost," "where does an X run spend," "which runs
drive spend," and "does cost scale with district size."

## Methodology (these are not optional)

| Rule                                            | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trust `costUsd`, never list price**           | The canonical cost of a run is the DB column `experiment_run.costUsd`. It is **invoice-validated**: on 2026-06-22, summing `costUsd` over all `experiment_run` rows for that UTC day was **$342 vs the real Anthropic key bill of $335** (~2%; the DB captures ~100% of actual). NEVER report dollars derived from token-count x list price — at Opus list rates that overshoots actual by ~25%. Per-turn token totals are used ONLY as weights to distribute the trusted `costUsd` across turns: `cost_of_turn_i = costUsd * (tokens_i / sum_tokens)`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Population, never sample**                    | Every analysis covers ALL runs in scope and reports coverage (logs parsed / runs in scope). Never characterize a cohort from one run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Distributions, not point estimates**          | Report median, p90, p99, max, and the Pareto tail (which runs drive the bulk of spend) — not just a mean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Milestone attribution (live, with fallback)** | The `pmf_runtime.milestone()` primitive is live in gp-ai, and `build-cap-agent` agents now mark a milestone at each Step boundary. When a run has a `milestones.jsonl` (sibling of `session.jsonl`), the extractor tags each turn with its active milestone (most recent marker at/before the turn's timestamp), and analysis attributes cost **per named milestone**: `cap_cost_analyze` emits a `milestone_costs` table and keys the population heatmap on the **ordered milestone**, and `cap_cost_hotspots` detects hot **milestones**. When a cohort has NO markers (pre-primitive runs, or agents that emitted none) the milestone column is null and every module **falls back to normalized turn progress** exactly as before. Coverage reports both log coverage and milestone coverage; a cohort can be mixed (some runs marked, some not). There is still no regex/TodoWrite step classifier — markers are the only milestone source. |
| **Cost per milestone is MARGINAL**              | A milestone's cost is the **marginal** spend from the previous milestone firing until this one — the sum of per-turn cost over the turns tagged with that milestone (i.e. the turns between this marker and the next). `milestone_costs()` in `cap_cost_analyze` computes exactly this, per milestone, in run-sequence order: `total` (marginal $), `share_of_spend` (fraction of cohort spend), `cumulative_share` (a Pareto over phases), `cost_per_turn` (marginal $/turn within the phase), and `median_per_run` / `p90_per_run`. Read it as "which phase of the run the money goes to," not "cost as of this milestone." On a mixed cohort, shares are fractions of TOTAL cohort spend so they sum to <1.0.                                                                                                                                                                                                                                          |

## Prerequisites

- AWS access via SSO profile `gp-admin`. Export creds for the boto3 SDK and clear
  the profile so the SDK does not re-resolve it in-process:
  ```bash
  eval "$(aws --profile gp-admin configure export-credentials --format env)"
  unset AWS_PROFILE
  export AWS_REGION=us-west-2
  ```
- Prod DB: pulled automatically from Secrets Manager `GP_API_PROD` (host
  `gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com`, db `gpdb`, user
  `gpuser`). The module is **read-only** — it only SELECTs `experiment_run`.
- Run from `packages/runbooks/scripts/python` via `uv run python cap_cost_*.py`.
- District segmentation (stage 6) additionally needs Databricks env
  (`DATABRICKS_SERVER_HOSTNAME` / `DATABRICKS_HTTP_PATH` / `DATABRICKS_API_KEY`).
- Hot-region labeling (stage 4 `--label`) needs `ANTHROPIC_API_KEY`.

## Stages

Each stage is one module; they chain through cached JSON / parquet so re-analysis
never re-pulls S3.

| Stage                             | Module                 | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scope resolver                 | `cap_cost_scope.py`    | English/filters -> run rows from `experiment_run`. Prints count + UTC window for confirmation; writes `scope.json`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2. Per-turn extractor             | `cap_cost_extract.py`  | Fetches each run's `session.jsonl` (and sibling `milestones.jsonl` when present), parses per-turn tokens, tags each turn with its active milestone, distributes `costUsd` across turns by token weight, writes ONE cached `turns.parquet` + a coverage file (log + milestone coverage).                                                                                                                                                                                                                                      |
| 3. Analytics + plots              | `cap_cost_analyze.py`  | Distribution tables (median/p90/p99/max + Pareto tail, per status) and plots: cumulative-cost curve, cost-velocity (spikes annotated by the turn's tool call), population heatmap (X = ordered milestone when markers present, else normalized turn progress). When markers are present, also a MARGINAL `milestone_costs` attribution table (total / share / cumulative share / $-per-turn / median-per-run), a `milestone_costs.png` cost-per-milestone bar chart (top-3 phases highlighted), and `milestone_heatmap.png`. |
| 4. Hot-region detector            | `cap_cost_hotspots.py` | Population-level hot **milestones** when markers are present, else hot turn-progress bands; `--label` calls the Anthropic SDK on ONLY the hot slices to name what work is expensive there.                                                                                                                                                                                                                                                                                                                                   |
| 5. Per-job profile                | `cap_cost_profiles.py` | Buckets outcomes from the S3 artifact and computes the job's headline metric. Profiles live in `PROFILES` (see below).                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6. District segmentation (opt-in) | `cap_cost_segment.py`  | Joins cohort orgs -> `int__icp_offices.voter_count`, buckets `<10k/10k-50k/50k-100k/>100k`, reports cost per segment. Only when the question implies district scaling.                                                                                                                                                                                                                                                                                                                                                       |
| 7. HTML report                    | `cap_cost_report.py`   | One self-contained, shareable HTML report over the stage-1/3/5 outputs (inline CSS, PNGs embedded as base64, no external URLs, print-to-PDF clean). Data-driven and degrades gracefully. Renders the **standard report layout** below — see "Report design".                                                                                                                                                                                                                                                                 |

## Scope resolver — English first

Translate the operator's request into one `cap_cost_scope.py` invocation, then show
them the printed count + UTC window before pulling anything:

| They say                   | You run                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| "the 6/22 briefing cohort" | `--type meeting_briefing --on 2026-06-22`                                            |
| "last 3 briefing cohorts"  | `--type meeting_briefing --last-cohorts 3` (clusters `createdAt` by dispatch window) |
| "briefings since June 20"  | `--type meeting_briefing --since 2026-06-20`                                         |
| "these specific runs"      | `--run-ids r1,r2,r3` or `--run-ids-file ids.csv`                                     |

```bash
cd packages/runbooks/scripts/python
uv run python cap_cost_scope.py --type meeting_briefing --on 2026-06-22
```

## Running the chain

```bash
cd packages/runbooks/scripts/python
S=outputs/cap-cost/meeting_briefing

uv run python cap_cost_scope.py   --type meeting_briefing --on 2026-06-22 --out $S/scope.json
uv run python cap_cost_extract.py --scope $S/scope.json --out $S/turns.parquet
uv run python cap_cost_analyze.py --turns $S/turns.parquet --outdir $S/plots
uv run python cap_cost_hotspots.py --turns $S/turns.parquet --label
uv run python cap_cost_profiles.py --scope $S/scope.json

# opt-in, only when the question is about district scaling:
uv run python cap_cost_segment.py --scope $S/scope.json

# one self-contained, shareable HTML report over the outputs above:
uv run python cap_cost_report.py --exp-dir $S
```

Re-analysis (stages 3-7) reads `turns.parquet` / `scope.json` — never re-pulls S3.

## Per-job profiles

A profile maps an `experimentType` to its artifact status field (e.g.
`briefing_status` vs `status`), success status, outcome buckets, and a
headline-metric function. They live in `PROFILES` in `cap_cost_profiles.py`.
Human-readable guidance per job lives in `profiles/`:

- `profiles/meeting_briefing.md` — headline = dollars per delivered briefing
  (including failed attempts), the milestone-attribution note (live, with
  turn-progress fallback for pre-primitive runs), and standing findings.
- `profiles/community_issues.md` — covers BOTH `top_community_issues` and
  `trending_issues` (one shared registry shape); headline = dollars per delivered
  issue list (`data_quality` ok/partial, including failed attempts), milestone
  phases live from manifest v4, and standing cost findings from the v3 cohorts.

To analyze a new job, add its profile to `PROFILES` and a `profiles/<type>.md`.

## Report design

`cap_cost_report.py` (stage 7) is the ONE place a cohort's analysis becomes a
shareable artifact. Every cost report is the same report: the layout and design
below are fixed so reports are complete (no measurement silently dropped) and
consistent (they look like the same document across cohorts). Don't hand-roll a
one-off layout — extend this one.

### Standard layout (ordered; every report includes all applicable)

1. **Header** — eyebrow, `<exp_type>` cohort headline figure, one-line lede,
   mono meta-line (cohort window, `n=` runs, log coverage, source).
2. **Summary stat band** — the 4-card metric row: headline (profile metric, or
   total when no profile) / per-run / total cohort cost / delivered-vs-total.
3. **What the cohort produced** — outcome-mix table (only with a profile).
4. **Where the money goes** — the cost-driver prose (cache_read share,
   cost↔turns correlation, turn distribution); generic line if no parquet.
5. **Cost distribution + Pareto tail** — per-run median/p90/p99/max table plus
   the Pareto callout (how many runs drive 80% of spend). Per status.
6. **Cost per milestone** — WHEN markers are present: the marginal
   cost-per-milestone measurement. A framing note (marginal = spend since the
   previous marker), a concentration callout (top-3 phases' combined share), the
   `milestone_costs.png` bar chart, and the table (marginal $ / share /
   cumulative / $-per-turn / median-per-run). Omitted entirely when the cohort
   has no markers — its absence is named in the footer caveat instead.
7. **Cost over the run lifecycle** — the charts: cumulative-cost curve,
   cost-velocity, and the population heatmap (**milestone heatmap** when markers
   present, **turn-progress heatmap** as the fallback / mixed-cohort full view).
8. **Method and trust** — the `costUsd` invoice-validation paragraph.
9. **Footer** — generated date, scope, and a "Not run:" caveat line listing any
   measurement that was skipped (no parquet, no markers, no profile).

Sections 3/4/6 degrade gracefully: a missing profile, parquet, or milestone
markers drops the section and is flagged in the footer, never crashes.

### Design spec (utilitarian dashboard)

A cost report is scanned and operated, not read cover to cover, so information
design leads. Keep the treatment restrained and identical across cohorts. The
spec below is the inline `CSS` block in `cap_cost_report.py` — match it; don't
introduce a new palette or font per report.

- **Palette (cool-neutral + one accent + semantic).** Ground is a cool off-white
  paper `#f5f6f8` / white cards `#ffffff` / near-black ink `#16191f`; neutrals
  are slate `#56606e` / `#7c8694` with hairline `#e4e7ec`. The one accent is
  teal `#0f6e63` (+ soft `#e6f1ef`), used for the headline figure, lead card, and
  emphasized `.fig`. Semantic status is SEPARATE from the accent: success →
  accent teal, miss/placeholder → warn amber `#b45309`, failure → neutral slate.
- **Type.** System font stack for UI (`system-ui, -apple-system, "Segoe UI"…`)
  and a mono stack (`ui-monospace, "SF Mono", Menlo…`) for every figure, table
  cell, meta-line, and footer. No webfonts — the CSP blocks font CDNs and a
  linked face silently falls back. `tabular-nums` on ALL numeric columns and
  `.fig`/`.val` figures so digits align. Balance headings, ~65ch body measure.
- **Self-contained.** Inline `<style>`; every PNG embedded as a base64 `data:`
  URI (`embed_png`); NO external URLs, scripts, or fonts. The report may be
  published as an Artifact under a strict CSP, so an external asset would fail
  silently. The test suite asserts `http://` / `https://` never appear.
- **Layout.** Single centered column (`max-width: 840px`). Wide content (every
  table) sits in a `.tbl-wrap` with `overflow-x: auto` so the page body never
  scrolls sideways. Cards/charts in flex/grid with `gap`. Metric grid collapses
  4→2 columns under 680px.
- **Print-to-PDF.** A `@media print` block whitens the ground, drops the column
  cap, sets `@page` margins, and `break-inside: avoid` on cards/figures/tables so
  "Save as PDF" yields a clean document.

When adding a NEW measurement to the pipeline, add it to the ordered layout above
AND render it in `cap_cost_report.py` in the same change — a measurement the
analyze stage computes but the report omits is an incomplete report.

## Reference only

The Anthropic per-token pricing table (`REFERENCE_PRICING_USD_PER_MTOK` in
`packages/runbooks/scripts/python/cap_cost_extract.py`) is kept
for sanity-checking token MIX only. Never compute spend from it — see the trust rule
above. The predecessor runbook this skill supersedes contributed its `session.jsonl`
per-turn parser and S3 layout, which are reused; its regex step-classifier is intentionally
dropped.
