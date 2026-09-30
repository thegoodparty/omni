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

Wave 0 laid down the contracts every other build track compiles against.
The chat runner is the first arm on top of them; no judge or report yet.

| File                  | What it is                                                                     |
| --------------------- | ------------------------------------------------------------------------------ |
| `record.ts`           | The one cross-track contract. **Frozen.**                                      |
| `agents.ts`           | Every agent the judge covers, wired or not. The coverage denominator.          |
| `fixtures/records.ts` | Synthetic records, one pair per shape the layers above a runner must handle.   |
| `cli.ts`              | Agent selection and `--dry-run`. Skeleton.                                     |
| `pricing.ts`          | Versioned token rates. Re-derive cost from here; never compare stored dollars. |
| `runners/chat.ts`     | Drives one real chat turn through the HTTP routes and emits one record.        |

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

That is enforced, not just asked for. A run with no `script` would be
answered by the real, paid model, and a forgotten field type-checks cleanly —
so the paid path takes two deliberate acts: `realModel: true` on the request
**and** `JUDGE_SPEND=1` in the process. Omit either and the run throws before
anything is patched.

## Cost is re-derived, never compared as stored

A record carries raw token counts, the model and a `pricingVersion`, plus
`cost.usdAtCapture`, which is only a snapshot.

`cost` is **optional**. It is absent when nobody could price the run — an
unpriced model, or cache tokens with no rate. Absent rather than zero,
because a stored 0 under a real `pricingVersion` reads as "this run was
free" and `sharesPricing()` would call two arms comparably priced when one
was never priced at all. And absent rather than fatal: cost is measured
evidence, measured evidence never gates a verdict, so an unpriceable run
keeps its status and its answer and loses only its cost line. This is a live
path, not a hypothetical — every chat scope declares a `claude-opus-4-7`
fallback that `pricing.ts` has no rates for.

**Compare with `priceUsd()` from `pricing.ts`. Do not compare
`usdAtCapture` between two records.** A cached base arm can predate its
candidate by months, so comparing two stored figures measures Anthropic's
price list as much as it measures the branch. Re-deriving means a price
change re-prices all of history for free, the same way a rubric change
re-grades stored records without re-running an agent.

Tokens are split by how they are billed, including `cacheRead` and
`cacheWrite`. Both are zero in every record today because prompt caching is
not enabled, which is exactly why the fields exist now. `priceUsd` throws
rather than pricing a cache read at the full input rate, because doing so
overstates it by roughly ten times and would silently invalidate every
stored comparison. Switching caching on therefore fails loudly and needs
rates added to `pricing.ts`.

A background record's counts come from the `type: result` line of the run's
`conversation.jsonl`, under `usage`: `input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens` (written by
`_usage_counts` in `packages/gp-ai/pmf_engine/runner/harness/claude_sdk.py`).
The harness prices its turns in-process, so before those were logged the only
token-derived figure on the line was a dollar amount and `priceUsd()` over a
background record re-derived 0 on both arms.

**An unobserved count is absent, never zero.** The harness logs only the
counts the SDK actually reported: a `ResultMessage` with no usage object
produces a line with no `usage` key at all, and a single garbled field drops
that one key rather than writing it as 0. A reported zero is an observation
and does reach the line, which is what the cache-read guard above needs. So a
`usage` missing a key is a record to reject, not a record to price — zero is
legal to `priceUsd` and would turn a $4 run into $0.00 beside a verdict.

Every result line carries `usage_schema: 1`. A sweep's two arms are two
checkouts at two commits, so a base arm predating the counts writes a line
with no `usage` key for a reason that has nothing to do with the run. The
stamp is how a normalizer tells "this harness did not log counts" from "this
run's counts were not observed".

**Follow-up, not done here: `TokenUsageSchema` cannot express "unknown".** Its
four fields are non-optional ints, so a normalizer reading a partial or absent
`usage` has no way to record that the count is unknown — its only options are
to reject the record or to invent a zero. Until that is resolved, a
cross-commit sweep whose base arm predates the counts would report the
candidate's entire spend as a cost regression against a $0 base. `record.ts`
is the frozen cross-track contract with other branches in flight against it,
so the change goes through review rather than a drive-by.

An unknown model throws too. The cost delta is printed beside a verdict as
evidence, and a guessed or zero rate makes that evidence fiction.

## Where a record came from

`ci` carries the repo, PR number, workflow run id and URL, so a stored
record leads back to the change it judged rather than to a bare commit hash.
It is absent on a local run.

`ci.workflowRunId` is not the record's `runId`. That one is the agent run,
this one the Actions run. They are named apart on purpose.

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
npx vitest run src/chats/evals            # from packages/gp-api
npm run verify -w packages/gp-api         # what CI runs, unfiltered

# The CLI as a command, which is the only way to catch a missing entry point
npx tsx src/chats/evals/judge/cli.ts --agents=all --dry-run
```

Invoke the CLI rather than importing `run()` when you want to know the
command works. A wrapper that imports the function and logs the result
proves the function: an earlier version of this file exported `run` and
never called it, so the command printed nothing and exited 0, and a test
built that way could not have noticed.

Run the typecheck, not just the tests: vitest uses SWC and does not
typecheck, so a tsc-only error passes the suite and fails CI.
