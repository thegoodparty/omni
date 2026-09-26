# universal-judge

Blind graded-pairwise A/B evaluation for GoodParty agents. Ask for it on a PR:

> run the universal judge on meeting briefings and ordinances and community issues

and a workflow runs the PR's variant and the base branch's variant against the same
fixed inputs, has a judge compare each pair without knowing which is which, and
posts a table back to the PR.

This exists because we change agents constantly — a cheaper model, a tightened
prompt, a dropped tool — and until now the only way to know whether a change helped
was to read a handful of outputs and form an impression. That does not scale and it
does not survive disagreement. See ENG-11085.

## What it is not

This is a **separate system** from the existing eval machinery, on purpose. It does
not read, extend, or run:

- `packages/runbooks/experiment-evals/` (per-experiment quality bars)
- `packages/runbooks/experiments/<id>/qa/` (the observe-only in-run QA gate)
- `packages/gp-api/src/chats/general/*/evals/` (cold-judge panels, rubrics,
  citation verifiers)

Those grade **one** output against a bar. This compares **two** outputs against each
other. The one thing it borrows is ordinance fixture data and its seeder, which is
test data rather than evaluation logic.

## The model

**A variant is a git ref.** That single idea covers both kinds of agent:

| Kind           | What the variant is                     | How an output is produced                                                       |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| **background** | a CAP experiment manifest + instruction | published under a throwaway clone id, dispatched via SQS, artifact read from S3 |
| **foreground** | the gp-api source tree itself           | a producer test runs inside each checkout and writes one JSON file              |

The baseline is never re-published: `publish-experiments.yml` republishes every
experiment on push to main, so what is already in the dev index _is_ main. Only the
candidate gets a clone, and it is deleted when the run ends.

## Judging

One rubric applies to every agent (`rubrics/universal.md`), with an optional
per-agent addendum (`rubrics/<agent>.md`) that adds criteria but never removes one.
The universal rubric is tiered — integrity, then substance, then craft — so a
fabrication decides a comparison no matter how well written the other side is.

Three properties worth keeping:

- **Blind.** The judge is not told which side is the incumbent.
- **Order-swapped.** Every pair is judged twice with the outputs swapped. A pair
  whose verdict reverses is reported as unstable and excluded from scoring. When
  more than 20% of pairs flip, the whole comparison is reported as inconclusive
  rather than given a number.
- **No outside knowledge.** The judge grades internal consistency and grounding in
  the sources the output itself cites. It does not browse and does not fact-check
  against what it happens to know.

A verdict is withheld below six non-tied cases. A two-sided sign test on n cases
bottoms out at 2/2^n, which first crosses 0.05 at n=6, so a smaller sample gets its
tally reported and no direction claimed. Run-to-run variance alone will sweep two or
three cases, which is exactly how this rule got written.

Verdicts are graded pairwise only — `much_better`, `better`, `tie` — which gives
direction and the approximate magnitude the brief asks for, without pretending to a
precision this cannot support.

## Running it locally

```bash
npm run judge -w packages/universal-judge -- --help

# See what a request would do, without spending anything.
npm run judge -w packages/universal-judge -- \
  --comment "run the universal judge on community issues" --dry-run

# A real background comparison.
npm run judge -w packages/universal-judge -- \
  --agents find_existing_ordinances --samples 6 \
  --baseline-ref main --candidate-ref my-branch \
  --experiments-dir "$PWD/packages/runbooks/experiments" \
  --env dev --out /tmp/report.md
```

Re-judge outputs that already exist, with no AWS and no agent spend — this is how
you iterate on a rubric:

```bash
npm run judge -w packages/universal-judge -- --replay path/to/replay.json
```

A replay file is `{agent, pairs: [{caseId, input, baseline, candidate, ...}]}`.

Needs `ANTHROPIC_API_KEY` and AWS credentials for the dev account. Foreground agents
additionally need `--baseline-checkout` and `--candidate-checkout`, plus Docker,
since the producer boots gp-api against a testcontainer Postgres.

## Cost

Both sides of every case are real agent runs, so a comparison costs roughly
`2 x samples x per-run cost`. Guardrails, all enforced in code after any model has
had its say:

- 6 cases per agent by default (the fewest that can clear the power floor below),
  10 maximum
- a $75 estimated-spend ceiling per comment, which trims the sample count rather
  than refusing the request
- baseline outputs are cached per `(agent, base ref, case)`, so repeat comments on a
  PR only pay for the candidate. Say "refresh baseline" to force a re-run.

## Adding an agent

1. Add an entry to `src/registry.ts` with its kind, aliases, and per-run cost.
2. Add `cases/<agent>.json` with fixed golden inputs.
3. Optionally add `rubrics/<agent>.md`.
4. For a foreground agent, add a producer and register it in
   `src/adapters/gpApiForeground.ts`.

Nothing else changes — dispatch, judging, aggregation, and the PR comment are all
agent-agnostic.

## Known limits

- **Background variants are manifest-only.** A PR that changes the runner, broker,
  or harness needs a container image build, which this does not do.
- **The comment trigger cannot be tested before it lands.** `issue_comment`
  workflows only execute from the version on the default branch. The CLI is the
  real interface and runs identically everywhere; the workflow is a thin shell over
  it.
- **Cost is best-effort.** The authoritative per-run figure is
  `experiment_run.costUsd` in Postgres, which CI cannot reach. Costs are read from
  the session transcript when present and shown as a dash when not.
- **Meeting-briefing cases go stale.** They name real future meeting dates. Refresh
  them when runs start returning no-meeting-found across the board.
