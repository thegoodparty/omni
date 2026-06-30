# PMF Experiments

Manifests + instructions for the PMF agent system. Each subdirectory is one
experiment; published to S3 as `s3://agent-experiment-metadata-{env}/<id>/`
where the dispatch Lambda, broker, and Fargate runner read it at runtime.
Adding or editing an experiment requires zero code deploys.

**Authoring or porting an experiment: use the `build-cap-agent` skill**
(`.claude/skills/build-cap-agent/SKILL.md`). It owns the full runbook → experiment
procedure: the instruction.md skeleton, the broker-quirk CRITICAL RULES, manifest
and schema discipline, cloud Databricks querying, the clean-context authoring loop,
and publish + SQS dispatch testing in dev. **Analyzing experiment cost: use the
`analyze-cap-agent-costs` skill.** This file covers only what is specific to the
experiments directory itself.

## Eval artifacts live in the sibling `experiment-evals/` tree (NOT here)

Keep `experiments/<id>/` purely operational — the publisher walks it and ships
`manifest.json` + `instruction.md` + `attachments/` to S3, and the runtime agent
reads only that. An experiment's **output-quality rubric** and its evidence do
NOT belong here; they live in the sibling top-level **`experiment-evals/<id>/`**
tree, which the publisher never touches and the runtime agent never sees:
`quality_rubric.md` (the eval contract), `validation_log.md`, and an example
`rubric_scores.tsv`. They're applied by cold-judge subagents per
`books/build-output-quality-rubric.md`, tallied by
`scripts/python/rubric_verdict.py`. Per-run eval evidence stays in gitignored
`outputs/rubric-runs/`; an _adopted_ rubric graduates into `experiment-evals/<id>/`
in its own PR (eval artifacts are reviewed separately from the system that builds them).

## Lifecycle: every experiment starts as a runbook

The path from idea to a self-service dashboard feature goes through two phases:

```
Phase 1: prove the workflow as a runbook (human-runnable)
   books/find-<thing>.md
        │  iterate on real data via shell + databricks_query.py
        ▼
Phase 2: port to a self-service PMF experiment (agent-runnable)
   experiments/<thing>/
       manifest.json     ← contract schema, scope, routing
       instruction.md    ← the runbook's steps, written for the agent
```

Build it twice on purpose. Runbooks are forgiving (a human can spot-fix Databricks
SQL, swap a column, retry) and cheap to iterate. Experiments are autonomous: the
agent follows the instruction blindly, so every quirk (the broker auto-injects
state/city, `Voters_Active='A'`, `hs_*` are 0-100 scores) must be encoded
explicitly, and each Fargate iteration costs $0.30+. The runbook stays as both
documentation and a debugging tool when the experiment breaks in prod. The full
porting procedure, and the clean-context subagent loop that surfaces doc gaps, lives
in the `build-cap-agent` skill.

## Naming convention

Pair the runbook and experiment so the lineage is obvious:

| Runbook (kebab-case, action-prefixed) | Experiment (snake_case, no prefix)  |
| ------------------------------------- | ----------------------------------- |
| `books/find-district-issue-pulse.md`  | `experiments/district_issue_pulse/` |

Drop the action verb (`find-`, `research-`, `analyze-`), convert kebab to snake,
that's your experiment id. The id is locked into many downstream places
(`EXPERIMENT_ID` env var, S3 key, ExperimentRun row, gp-api EXPERIMENT_IDS) so pick
it carefully and never rename later.

## Subdirectory layout

Each experiment dir holds two required files plus an optional `qa/` folder:

```
experiments/
├── _schema/
│   ├── manifest.schema.json       ← meta-schema (validates every manifest)
│   └── qa.schema.json             ← validates each qa/manifest.json
├── <experiment_id>/
│   ├── manifest.json              ← routing config + contract schema + scope
│   ├── instruction.md             ← agent's system prompt (steps + rules)
│   └── qa/                        ← OPTIONAL QA gate (published when present)
│       ├── manifest.json          ← gate config (blocking, budgets) — required if qa/ exists
│       ├── main.py                ← deterministic checks (schema, grounding, integrity)
│       └── eval.md                ← LLM evaluator instruction (editorial scoring)
├── index.json                     ← built by publish_experiments.py (do NOT hand-edit)
└── CLAUDE.md                      ← this file
```

The publisher uploads `manifest.json`, `instruction.md`, and the whole `qa/`
folder (validating `qa/manifest.json` against `qa.schema.json`). Other stray files
in an experiment dir are ignored.

## The QA folder (qa/) — two entrypoints, two jobs

When an experiment has a `qa/` folder, the gate runs **two stages** with a strict
division of labor. Keep them in their lanes:

| File         | Job                                                                                                                                                                                                                                           | Does NOT do                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qa/main.py` | **Deterministic, mechanical checks** — schema validity, cross-reference integrity, claim grounding (each `source_extract` substring-checked against its cited source), discovery completeness, disclosure presence. Cheap, exact, repeatable. | Editorial judgment, quality scoring.                                                                                                                     |
| `qa/eval.md` | **Lightweight editorial scoring** by a single LLM judge — eligibility gate + a small set of 1-5 quality dimensions, scored against the artifact's OWN embedded content in one read.                                                           | Per-claim grounding, source re-fetch, web search, or fact-checking against reality — those are individual checks owned by `main.py` and other processes. |

**The rule for eval.md: keep it lightweight and editorial.** The evaluator scores
quality; it does NOT verify facts. It must not web-search, re-fetch cited sources, or
re-do per-claim grounding — individual claim-level checks belong to `main.py`'s
deterministic stage (and any downstream verification process), not the judge. Every
turn the judge spends re-investigating is a turn stolen from its bounded budget, and
it duplicates work the deterministic stage already did exactly. Give the judge `Bash`
only, point it at the embedded artifact, and ask it to read once and score.

This split is why the gate is fast and trustworthy: the cheap deterministic stage
catches the mechanical/grounding failures with zero ambiguity, leaving the expensive
LLM to do only the thing code cannot — judge editorial quality.

## Validation

Before publishing, always:

```bash
cd scripts/python
uv run pytest test_experiment_manifests.py -v
```

This runs the meta-schema validator against every manifest and checks the
directory/id alignment, JSON Schema Draft-07 conformance of `input_schema`/`output_schema`,
and required `instruction.md` presence. CI runs the same tests on PR.

## Publishing

```bash
cd scripts/python
AWS_PROFILE=work uv run python publish_experiments.py --env=dev
```

The script validates → uploads per-experiment files → writes `index.json`
LAST as an atomic switch. New dispatches see the new bytes within ~60s
(Lambda's index.json TTL cache).

## Known experiment family: Know Your Opponent

Four experiments here back one gp-api feature (`packages/gp-api/src/raceOpponent/`).
They split into **two pipelines that do not interact** — match the experiment to the
pipeline before editing, since the names are easy to confuse:

| Experiment | Pipeline | gp-api consumer | Sourcing |
|------------|----------|-----------------|----------|
| `race_opponent_collection` | relaxed (the live `/dashboard/race-opponent` page) | `RaceOpponentService.collect`/`collectManual` | relaxed |
| `race_opponent_summary` | relaxed (chained after collection) | reads `RaceOpponentSummary` | relaxed |
| `self_research` | strict engine (candidate's own pass) | `SelfResearchService` | sourced-or-silent |
| `opponent_research` | strict engine (sourced findings → contrasts) | `OpponentResearchService` | sourced-or-silent |

The two strict experiments carry a `qa/` grounding gate (each `source_extract`
substring-checked against its cited source); the relaxed two structure
already-collected text and do not. `opponent_research`'s `candidate_platform` input is
built from `Website.content.about`, not Campaign Story (gp-api ENG-10607) — if you
change that input shape, change the gp-api producer in the same PR. See
`packages/gp-api/src/raceOpponent/CLAUDE.md` for the full split and gating.

## See also

- `.claude/skills/build-cap-agent/SKILL.md` — author/port a runbook into an experiment (contracts, broker quirks, Databricks, dispatch + monitor)
- `.claude/skills/analyze-cap-agent-costs/SKILL.md` — cohort cost analysis for deployed experiments
- `books/find-district-issue-pulse.md` — example runbook (paired with `experiments/district_issue_pulse/`)
- `_schema/manifest.schema.json` — the meta-schema, source of truth for manifest validation
- `_schema/qa.schema.json` — the QA-gate config schema (validates each `<experiment_id>/qa/manifest.json`)
