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

| Rule                                   | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trust `costUsd`, never list price**  | The canonical cost of a run is the DB column `experiment_run.costUsd`. It is **invoice-validated**: on 2026-06-22, summing `costUsd` over all `experiment_run` rows for that UTC day was **$342 vs the real Anthropic key bill of $335** (~2%; the DB captures ~100% of actual). NEVER report dollars derived from token-count x list price — at Opus list rates that overshoots actual by ~25%. Per-turn token totals are used ONLY as weights to distribute the trusted `costUsd` across turns: `cost_of_turn_i = costUsd * (tokens_i / sum_tokens)`. |
| **Population, never sample**           | Every analysis covers ALL runs in scope and reports coverage (logs parsed / runs in scope). Never characterize a cohort from one run.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Distributions, not point estimates** | Report median, p90, p99, max, and the Pareto tail (which runs drive the bulk of spend) — not just a mean.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Milestone-less for now**             | A `pmf_runtime.milestone()` runtime primitive does not exist yet (separate future effort in gp-ai-projects). Until it lands, analysis is **turn-level only**. There is no regex/TodoWrite step classifier. The population heatmap is keyed on **normalized turn progress**, not milestone. Where per-milestone output would go, the modules emit the note: "Per-milestone cost attribution is pending the `pmf_runtime.milestone()` primitive (separate PR); until then, analysis is turn-level."                                                       |

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

| Stage                             | Module                 | Does                                                                                                                                                                                                              |
| --------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scope resolver                 | `cap_cost_scope.py`    | English/filters -> run rows from `experiment_run`. Prints count + UTC window for confirmation; writes `scope.json`.                                                                                               |
| 2. Per-turn extractor             | `cap_cost_extract.py`  | Fetches each run's `session.jsonl`, parses per-turn tokens, distributes `costUsd` across turns by token weight, writes ONE cached `turns.parquet` + a coverage file.                                              |
| 3. Analytics + plots              | `cap_cost_analyze.py`  | Distribution tables (median/p90/p99/max + Pareto tail, per status) and plots: cumulative-cost curve, cost-velocity (spikes annotated by the turn's tool call), population heatmap (X = normalized turn progress). |
| 4. Hot-region detector            | `cap_cost_hotspots.py` | Population-level hot turn-progress bands; `--label` calls the Anthropic SDK on ONLY the hot slices to name what work is expensive there.                                                                          |
| 5. Per-job profile                | `cap_cost_profiles.py` | Buckets outcomes from the S3 artifact and computes the job's headline metric. Profiles live in `PROFILES` (see below).                                                                                            |
| 6. District segmentation (opt-in) | `cap_cost_segment.py`  | Joins cohort orgs -> `int__icp_offices.voter_count`, buckets `<10k/10k-50k/50k-100k/>100k`, reports cost per segment. Only when the question implies district scaling.                                            |

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
```

Re-analysis (stages 3-6) reads `turns.parquet` / `scope.json` — never re-pulls S3.

## Per-job profiles

A profile maps an `experimentType` to its artifact status field (e.g.
`briefing_status` vs `status`), success status, outcome buckets, and a
headline-metric function. They live in `PROFILES` in `cap_cost_profiles.py`.
Human-readable guidance per job lives in `profiles/`:

- `profiles/meeting_briefing.md` — headline = dollars per delivered briefing
  (including failed attempts), the milestone-less caveat, and standing findings.

To analyze a new job, add its profile to `PROFILES` and a `profiles/<type>.md`.

## Reference only

The Anthropic per-token pricing table (`REFERENCE_PRICING_USD_PER_MTOK` in
`packages/runbooks/scripts/python/cap_cost_extract.py`) is kept
for sanity-checking token MIX only. Never compute spend from it — see the trust rule
above. The predecessor runbook this skill supersedes contributed its `session.jsonl`
per-turn parser and S3 layout, which are reused; its regex step-classifier is intentionally
dropped.
