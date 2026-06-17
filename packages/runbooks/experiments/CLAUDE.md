# PMF Experiments

Manifests + instructions for the PMF agent system. Each subdirectory is one
experiment; published to S3 as `s3://agent-experiment-metadata-{env}/<id>/`
where the dispatch Lambda, broker, and Fargate runner read it at runtime.

Adding or editing an experiment requires zero code deploys. See
`books/convert-runbook-to-experiment.md` for the runbook → experiment
translation procedure.

## Lifecycle: every experiment starts as a runbook

The path from "I have an idea" to "candidates can run this from their
dashboard" goes through two phases:

```
Phase 1: prove the workflow as a runbook (human-runnable)
   books/find-<thing>.md
        │
        │  iterate on actual data via shell + databricks_query.py
        │  until the workflow produces good output reliably
        ▼
Phase 2: port to a self-service PMF experiment (agent-runnable)
   experiments/<thing>/
       manifest.json     ← contract schema, scope, routing
       instruction.md    ← the runbook's steps, written for the agent
```

This split exists because:
- **Runbooks are forgiving** — a human can spot-fix Databricks SQL, swap a
  column name, retry. Cheap to iterate.
- **Experiments are autonomous** — the agent has to follow the instruction
  blindly. Every quirk (broker auto-injects state/city, `Voters_Active='A'`,
  `hs_*` are 0-100 scores) must be encoded explicitly. Expensive iteration
  loop ($0.30+ per Fargate run).

So: build it twice. The runbook proves the workflow on real data. The
experiment encodes the workflow into a self-service product surface. The
runbook stays as both documentation and a debugging tool when the experiment
breaks in prod.

## Naming convention

Pair the runbook and experiment so the lineage is obvious:

| Runbook (kebab-case, action-prefixed) | Experiment (snake_case, no prefix) |
|---|---|
| `books/find-district-issue-pulse.md` | `experiments/district_issue_pulse/` |

Drop the action verb (`find-`, `research-`, `analyze-`), convert kebab to
snake, that's your experiment id. The experiment id is locked in many
downstream places (`EXPERIMENT_ID` env var, S3 key, ExperimentRun row, gp-api
EXPERIMENT_IDS) so pick it carefully and don't rename later.

This directory ships with **one worked example** (`district_issue_pulse`) that
demonstrates the full contract end-to-end. Production experiments are ported
individually in their own PRs as the team verifies each one against the
runbook → experiment loop below.

## Translating runbook → experiment

The reference procedure is in `books/convert-runbook-to-experiment.md`. High-level:

1. **Validate the runbook works on real data.** Don't translate something
   that hasn't proven itself end-to-end with shell tools.
2. **Read `books/convert-runbook-to-experiment.md` carefully.** It defines
   the input contract (a runbook), the output contract (manifest+instruction),
   the registries you must pick from (mode, scope.max_rows), and the
   broker quirks block to copy verbatim into your instruction's CRITICAL
   RULES.
3. **Author manifest.json.** Validate against the meta-schema before doing
   anything else: `cd scripts/python && uv run pytest test_experiment_manifests.py`.
4. **Author instruction.md.** Translate runbook steps into agent-runnable
   form. Put the broker-quirk rules in CRITICAL RULES at the top — the agent
   will skip them if they're buried.
5. **Publish to dev.** `cd scripts/python && uv run python publish_experiments.py --env=dev`.
6. **Dispatch a test SQS message** (gp-api UI may not be wired yet — direct
   SQS dispatch works for headless testing). See convert-runbook-to-experiment.md
   for the message body shape.
7. **Tail logs** across Lambda + broker + runner. Iterate the instruction
   based on actual agent behavior. Republish — no code deploy needed.

The goal: the experiment produces a JSON artifact matching `output_schema`
without human intervention. If the agent burns turns guessing at SQL or
fighting the broker scope, your instruction is missing a CRITICAL RULE.

## How to run the translation (the DX loop)

The translation itself should be done by a **clean-context subagent**, not by
you in your working session. You have context the subagent doesn't (other
experiments, prior debugging, what you "meant"). That context will fill in
gaps in the converter doc silently and you'll never notice the gaps. A
clean-context subagent surfaces every gap as either a question or an
inventive guess — both are signals to patch the doc.

### The loop

```
1. Author books/find-<X>.md and run it locally until it works on real data
2. Spawn a clean-context subagent with EXACTLY these inputs:
     - books/find-<X>.md            (the source runbook)
     - books/convert-runbook-to-experiment.md   (the converter)
     - experiments/_schema/manifest.schema.json (the meta-schema)
   Forbid it from reading anything else, especially other experiments.
3. Subagent writes experiments/<X>/{manifest.json, instruction.md} and runs
   pytest test_experiment_manifests.py
4. Subagent reports a TIGHT table of every field it chose, with each
   justification quoting the doc line that drove the choice.
5. Read the report. For every choice that was "I had to guess" or "I
   inferred from the runbook" rather than "the doc says X" → that's a gap
   in the converter doc.
6. If gaps exist:
     - Stash the output: mv experiments/<X>/ experiments/.collin_reference/<X>_subagent_vN/
     - Patch books/convert-runbook-to-experiment.md to close the gap
     - Re-spawn a fresh subagent (do NOT continue the previous one — it has
       contaminated context now)
     - Repeat until the subagent reports zero invented values
7. Once convergence (every field traces to a quoted doc line):
     - Publish to dev
     - Live-dispatch and verify the artifact (schema-valid ≠ functional)
```

### Why a subagent and not you

If you translate the runbook yourself, you'll silently fill in the
registries from memory (`winStandard` because you've used it before,
`scope.allowed_tables` from memory). That hides
gaps in the doc. A future translator (a different agent, a new engineer,
or you in 6 months) won't have that context and will re-invent the wheel
or pick wrong values.

The subagent is a stand-in for the future translator. Every time it
guesses, you've found a doc bug.

### What "clean context" means in the prompt

The subagent prompt MUST explicitly forbid reading other experiments and
the `.collin_reference/` stash dir. Without that constraint, it will look
at sibling experiments and copy patterns rather than follow the doc — same
hidden-context problem as if you did it yourself. See
`experiments/.collin_reference/` for prior runs that demonstrate this loop
on `district_issue_pulse`.

### Two layers of doc gaps (both feed back into the converter)

**Layer 1 — static gaps** (caught by step 4 above): the subagent reports a
"had to guess" choice. Patch the converter, re-spawn.

**Layer 2 — live-run gaps**: the experiment validates and dispatches, but
the live agent on Fargate burns turns "discovering" something it shouldn't
have to. This is the final check on the converter doc — schema-valid is not
the same as instruction-quality. Watch for:

- Agent introspects an API (`dir(...)`, `help(...)`) → the converter or the
  CRITICAL RULES block didn't give it the API verbatim. Patch the converter
  to include the canonical snippet (this is how the
  `from pmf_runtime import databricks as sql; conn = sql.connect()` pattern
  ended up in the Databricks broker quirks block).
- Agent hits the broker with a `ScopeViolation` or `422` and recovers → the
  CRITICAL RULES block was missing a rule, or the rule was buried.
- Agent emits an artifact that fails `validate_output.py` repeatedly → the
  output_schema is loose enough that the agent thinks it's done before the
  validator catches the gap. Tighten the schema (more `required`, more
  `pattern`, more `additionalProperties: false`).
- Agent burns turns deciding what to do next at a step boundary → the
  instruction skeleton in the converter doc isn't opinionated enough for
  that step type. Add a copy-paste-ready code block to the relevant section.

**The rule**: every turn the agent wastes on something the doc could have
told it is a gap in the doc, not a quirk of the agent. Patch the converter,
republish, re-dispatch. Each patch makes the next experiment cheaper to
translate AND cheaper to run.

## When NOT to start as a runbook

A few experiment shapes don't need a runbook precursor:

- **Pure data transforms** with a known schema (e.g. compute X from Y where
  both are well-defined).
- **Variants of an existing experiment** that reuse the same instruction
  pattern with a different contract.

Otherwise, start with a runbook. The savings on agent iteration cost is
substantial.

## Subdirectory layout

Each experiment dir holds exactly two files:

```
experiments/
├── _schema/
│   └── manifest.schema.json       ← meta-schema (validates every manifest)
├── <experiment_id>/
│   ├── manifest.json              ← routing config + contract schema + scope
│   └── instruction.md             ← agent's system prompt (steps + rules)
├── index.json                     ← built by publish_experiments.py (do NOT hand-edit)
└── CLAUDE.md                      ← this file
```

Anything else in an experiment dir gets ignored by the publish script.

## Validation

Before publishing, always:

```bash
cd /Users/collinpark/work/runbooks/scripts/python
uv run pytest test_experiment_manifests.py -v
```

This runs the meta-schema validator against every manifest and checks the
directory/id alignment, JSON Schema Draft-07 conformance of `input_schema`/`output_schema`,
and required `instruction.md` presence. CI runs the same tests on PR.

## Publishing

```bash
cd /Users/collinpark/work/runbooks/scripts/python
AWS_PROFILE=work uv run python publish_experiments.py --env=dev
```

The script validates → uploads per-experiment files → writes `index.json`
LAST as an atomic switch. New dispatches see the new bytes within ~60s
(Lambda's index.json TTL cache).

## See also

- `books/convert-runbook-to-experiment.md` — runbook → experiment converter
  (input/output contracts, broker quirks, dispatch + monitor)
- `books/find-district-issue-pulse.md` — example runbook (paired with
  `experiments/district_issue_pulse/`)
- `_schema/manifest.schema.json` — the meta-schema, source of truth for
  manifest validation
