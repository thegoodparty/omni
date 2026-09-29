# Universal Judge

Answers one question for any agent we run: **is this branch better, worse, or
the same as what it branches from?**

Nothing else. No thresholds, no per-agent rubric, no gold answers. Those are
absolute judgments, each needs a standard written per agent, and that is
exactly why agent eval coverage has stayed near zero. A comparison needs none
of it, which is the only reason one judge can cover every agent.

Design: the [TDD](https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-139733)
and the shorter [review doc](https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-140793).

## What is here so far

This is wave 0: the contracts every other build track compiles against, and
nothing else. No runner, no judge, no report yet.

| File                  | What it is                                                                   |
| --------------------- | ---------------------------------------------------------------------------- |
| `record.ts`           | The one cross-track contract. **Frozen.**                                    |
| `agents.ts`           | Every agent the judge covers, wired or not. The coverage denominator.        |
| `fixtures/records.ts` | Synthetic records, one pair per shape the layers above a runner must handle. |
| `cli.ts`              | Agent selection and `--dry-run`. Skeleton.                                   |

## If you are building a track

**Build against the fixtures, not against a runner.** The normalizer, the
judge, the scoring and the report are each a pure function over a record, so
every one of them can be written and fully tested before any agent runs. That
is what lets the tracks run in parallel.

```ts
import { CHAT_PAIR, TOOL_ERROR_PAIR } from './fixtures/records'
```

The pairs exist to cover the cases that are easy to forget:

- `CHAT_PAIR` — the ordinary comparison.
- `VOTER_QUERY_PAIR` — carries generated SQL and a pinned Delta version.
- `BACKGROUND_PAIR` — an opaque artifact output, same schema, no special case.
- `TOOL_ERROR_PAIR` — the candidate's tool failed but it still answered.
- `BLOCKED_PAIR` — the agent declined. Still an agent result, still judged.
- `INFRA_ERROR_PAIR` — the only case with a null output.
- `IDENTICAL_DIGEST_PAIR` — both arms saw the same config; refuse to run.

**`record.ts` is frozen.** If your track needs a field no fixture carries,
that is a change to the contract and it goes through review. Two tracks
inventing the same field differently is the failure this structure exists to
prevent.

**Never call a real agent.** No track in this build spends money; real runs
come after the merge. `RUN_LLM_EVALS=1` is not for this code.

## Two rules that are easy to get wrong

**A tool failure is never a quality signal.** The Databricks client resolves
lazily, so a broken credential does not fail a run — the agent answers with
less information instead. Both arms degrade identically, and a judge shown two
degraded outputs will confidently report a code regression. Use
`isComparable()`; any case where either arm hit a tool error resolves to
CAN'T SAY and leaves the delta.

**A refusal is a result, not a failure.** `blocked` keeps its output and stays
judgeable, because whether declining was correct is exactly what a verdict
should capture. Only `infraError` has no output.

## Verify

```bash
npx vitest run src/chats/evals/judge      # from packages/gp-api
npm run verify -w packages/gp-api         # what CI runs, unfiltered
```

Run the typecheck, not just the tests: vitest uses SWC and does not
typecheck, so a tsc-only error passes the suite and fails CI.
