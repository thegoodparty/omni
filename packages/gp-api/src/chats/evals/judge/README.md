# Universal Judge

Answers one question for any agent we run: **is this branch better, worse, or
the same as what it branches from?**

Nothing else. No thresholds, no per-agent rubric, no gold answers. Those are
absolute judgments, each needs a standard written per agent, and that is
exactly why agent eval coverage has stayed near zero. A comparison needs none
of it, which is the only reason one judge can cover every agent.

Design: the [TDD](https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-139733)
and the shorter [review doc](https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-140793).

## Running a sweep: THREE PROCESSES, NOT ONE

This is the shape of the whole thing, and it is forced rather than chosen. An
arm is a worktree, two worktrees are two module graphs, and one Node process
cannot import both. So a sweep is three invocations:

| Step | Command                                                                       | Where                          |
| ---- | ----------------------------------------------------------------------------- | ------------------------------ |
| 1    | `JUDGE_ARM=base npx vitest run src/chats/evals/judge/sweep.eval.test.ts`      | the **base** worktree          |
| 2    | `JUDGE_ARM=candidate npx vitest run src/chats/evals/judge/sweep.eval.test.ts` | the **candidate** worktree     |
| 3    | `npx tsx src/chats/evals/judge/sweep.ts`                                      | either — it only reads records |

Steps 1 and 2 must be vitest: `useTestService()` registers
`beforeAll`/`beforeEach`/`afterAll` to stand up the Postgres container and the
authenticated app, and those hooks exist only inside a vitest process. Step 3
must NOT be: it is pure functions over stored records, and pure functions in a
vitest file cannot be invoked from a workflow step cleanly.

`.github/workflows/judge.yml` drives all three. The arms meet in the record
store and nowhere else.

**Configuration comes from the environment, not argv**, because a test file has
no argv. Every value is Zod-validated up front and a missing one is a sentence
naming it.

| Variable               | Steps | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JUDGE_ARM`            | 1, 2  | `base` or `candidate`. **Absent means the suite skips**, so `npm run verify` does not drive an agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `JUDGE_SWEEP_ID`       | all   | The directory the two arms meet in. Must be identical in all three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `JUDGE_AGENTS`         | all   | Comma-separated agent ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `JUDGE_BASE_REF`       | 1, 2  | The base branch name, for `variant.ref`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `JUDGE_CANDIDATE_SHA`  | 1, 2  | The PR head commit the plan priced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `JUDGE_ARM_COMMIT`     | 1, 2  | HEAD of _this_ checkout. On the candidate arm it must equal `JUDGE_CANDIDATE_SHA`, or the checkout is not the commit under test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `JUDGE_RECORDS_DIR`    | all   | A local directory. Exactly one of this and the bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `JUDGE_RECORDS_BUCKET` | all   | An S3 bucket. Not wired in CI yet — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `JUDGE_SPEND`          | all   | Only the exact string `true` calls a real model. Anything else uses a canned reply, which is how the pipeline is exercised for nothing. **Step 3 spends too** — one panel call per judgeable pair, per seat — so all three must agree; step 3 refuses a setting that differs from what the arms' manifests recorded.                                                                                                                                                                                                                                                                                         |
| `JUDGE_DATA_VERSION`   | 1, 2  | The Delta version both arms read. Resolved ONCE by `dataVersion.ts` in a `sweep` step of its own, before either arm runs, and published as a step output both arms read: an arm that looked up "current" itself would look it up an hour after the other and get a different answer. Empty when the mart could not be read — no credential, a dead one, a history the warehouse will not hand over — which reads here as "not pinned". The sweep then proceeds against the live mart rather than refusing, because most agents never query it, and `report.ts` names every run that queried the mart anyway. |
| `JUDGE_CANDIDATE_REF`  | 1, 2  | Optional. The head ref name, for readability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `JUDGE_PR_NUMBER`      | all   | Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Exercise it locally, free, in one checkout:

```bash
export JUDGE_SWEEP_ID=local-1 JUDGE_AGENTS=chief_of_staff \
       JUDGE_BASE_REF=universal-judge JUDGE_RECORDS_DIR=/tmp/judge \
       JUDGE_CANDIDATE_SHA=$(git rev-parse HEAD)
JUDGE_ARM=base      JUDGE_ARM_COMMIT=$(git rev-parse HEAD~1) \
  npx vitest run src/chats/evals/judge/sweep.eval.test.ts
JUDGE_ARM=candidate JUDGE_ARM_COMMIT=$JUDGE_CANDIDATE_SHA \
  npx vitest run src/chats/evals/judge/sweep.eval.test.ts
npx tsx src/chats/evals/judge/sweep.ts
```

Step 3 will **refuse**, because one checkout gives both arms the same
`configDigest`. That is the refusal working, not a failure.

## The arms are sequential, and the TDD says otherwise

The TDD claims the orchestrator alternates arms in time — "base, candidate,
base, candidate" — so that a mid-sweep deploy or shifting data cannot pass for
a variant difference. **For chat that is not achievable**, for the reason above:
each arm is a separate process in a separate checkout. All of base runs, then
all of candidate. **The doc needs correcting.**

What happens instead (`armGap.ts`): each arm stamps when its capture started
and finished, the report prints the distance between the two windows, and a
comparison whose arms are further apart than `config.armGap.maxHours` is
flagged. The reader is told how long the world had to move rather than
reassured it was zero. This is the same treatment the background runner's
cached base arm already gets, so it is consistent rather than a special case.

## What is here

| File                                                   | What it is                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `record.ts`                                            | The one cross-track contract. **Frozen.**                                      |
| `agents.ts`                                            | Every agent the judge covers, wired or not. The coverage denominator.          |
| `fixtures/records.ts`                                  | Synthetic records, one pair per shape the layers above a runner must handle.   |
| `cli.ts`                                               | Agent selection and `--dry-run`. Plans a sweep; does not run one.              |
| `pricing.ts`                                           | Versioned token rates. Re-derive cost from here; never compare stored dollars. |
| `runners/chat.ts`                                      | Drives one real chat turn through the HTTP routes and emits one record.        |
| `cases.ts`                                             | Loads and validates one agent's case list.                                     |
| `cases/*.json`                                         | The case lists themselves. One per agent.                                      |
| `records.ts`                                           | The record store: local directory or S3, behind one narrow interface.          |
| `sweepArm.ts`                                          | Walks a case list for **one** arm. The runner is injected.                     |
| `sweep.eval.test.ts`                                   | Steps 1 and 2: the vitest shell that wires `sweepArm` to the real app.         |
| `sweep.ts`                                             | Step 3: reads both arms, judges, scores, reports.                              |
| `armGap.ts`                                            | The distance between the two captures.                                         |
| `identicalOutputs.ts`                                  | Refuses a sweep whose every pair came back byte-identical.                     |
| `normalize.ts` · `judge.ts` · `score.ts` · `report.ts` | The shared middle.                                                             |

## Two refusals, and they are not the same one

**Identical config.** Both arms hashed to the same `configDigest`, so the agent
could not have seen a difference. `normalize.ts` throws; `sweep.ts` turns it
into a refusal. This catches identical _input_.

**Identical output.** Every judgeable pair came back byte-identical even though
the digests differ, so nothing downstream used the difference — a candidate
override that rode along unread, a staging step that dropped a field. This
catches identical _output_, which is the later and stronger signal, and it
fires before any judge call. Configurable via
`gates.failOnAllIdenticalOutputs`, defaulting to refusing: a false alarm on a
genuinely inert change costs a re-read, and a false SAME costs a wrong
decision. The per-pair count is reported either way, because a few matching
pairs are ordinary and the count is what makes a dropped candidate obvious.

## Records outlive the run, but not in S3 yet

The design puts records at
`_judge/<sweepId>/records/<arm>/<agentId>/<caseId>-<attempt>.json` on
`gp-agent-artifacts-dev`, and `records.ts` has that store ready. The
workflow uses a local directory and uploads it as a workflow artifact instead,
because writing to S3 needs an IAM grant that does not exist yet **and**
`id-token: write` on the one job that runs the branch's own code with the
Anthropic and Databricks credentials in its environment. Widening that job's
permissions is a change to review on its own. Set `JUDGE_RECORDS_BUCKET`
instead of `JUDGE_RECORDS_DIR` once both land.

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

**`record.toolQueries` is always empty for a background agent.** Not a bug, and
not worth debugging when you see it. A background agent reaches the warehouse
by curling the broker from Bash, so its SQL is buried inside a shell command
string rather than in a structured `sql` tool argument, and only a structured
one is collected — regexing SQL back out of a shell string would put something
that is not the agent's verbatim query into a field whose entire value is being
verbatim. The chat agents, which call a real SQL tool, do populate it.

## Verify

```bash
npx vitest run src/chats/evals            # from packages/gp-api
npm run verify -w packages/gp-api         # what CI runs, unfiltered

# Both entry points AS COMMANDS, which is the only way to catch a missing
# entry point. The judging entry exits 1 and names the missing variable.
npx tsx src/chats/evals/judge/cli.ts --agents=all --dry-run
npx tsx src/chats/evals/judge/sweep.ts
```

Invoke them rather than importing `run()` or `main()` when you want to know
the command works. A wrapper that imports the function and logs the result
proves the function: an earlier version of `cli.ts` exported `run` and never
called it, so the command printed nothing and exited 0, and a test built that
way could not have noticed. `sweep.test.ts` spawns `npx tsx sweep.ts` for
exactly this reason.

Run the typecheck, not just the tests: vitest uses SWC and does not
typecheck, so a tsc-only error passes the suite and fails CI.
