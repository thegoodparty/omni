# Judge

`@goodparty_org/judge` — a small eval framework for background agents, like
Vitest for agents. It brings a base URL and a candidate URL into comparable runs
and grades the pairs.

Plan: `docs/judge-eval-framework-plan.md`. This package is phase 2.

For choosing, writing, and running suites, see [Writing agent evals](../../docs/agent-evals.md).

## Rules, enforced by construction

- **Every case runs 3 times on each side.** `ATTEMPTS_PER_SIDE`, not configurable.
- **Every run gets a new test user**, and so a new org, through
  `@goodparty_org/test-users`. A case's three attempts share the suite's
  `profile`, so only the identity is new.
- **Output is a string**: the exact text the judge reads. A background suite
  serializes its artifact.
- **Setup goes through public routes, or runs another agent.** Never writes rows.
- **No page replay, no pinned data version.** Both arms run at once, so the web
  and the voter mart are the same for both.
- **A suite never writes an org.** It writes the input shape the run route takes
  (`organization_slug` included, from `ctx.org.slug`), so one suite judges a run
  on either engine.

## Implementation

Vitest runs three attempts per case. Pairwise attempts grade both output orders,
and a case with no judged pairs fails. The run routes do not expose engine
identity today; annotations say `not reported` when it is missing.

| File                              | What                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| `src/pairwise.ts`                 | Suite registration, per-case execution, and verdict            |
| `src/suite.ts`                    | Suite definition types and validation                          |
| `src/arm.ts` and `src/apiRoot.ts` | Test-user context, API-root discovery, and run-route preflight |
| `src/runAgent.ts`                 | Agent run and polling routes                                   |
| `src/chatTurns.ts`                | Chat turns: opens the conversation, posts each turn, reads SSE |
| `src/grade.ts` and `src/stats.ts` | Grading, exact sign test, and handledWhen regression test      |
| `src/reporter.ts`                 | Markdown verdict table                                         |

## The grader

One pair per attempt, three pairs per case. Each pair is judged in **both
orders** — base as A and candidate as B, then swapped — and two orders that
disagree are a tie. One `generateObject` call returns the winner, `handledWhen`
as yes/partly/no per side, a 1-5 score per dimension (half points allowed: Claude's native JSON output
gives them, and an integer-only schema rejected whole verdicts), and one sentence of
reasoning. Default questions: `task_success`, `instruction_adherence`,
`user_utility`; a case's `grading.dimensions` adds to them.

`generateObject` from `ai` with a Zod schema — never a provider SDK — so
`JUDGE_MODEL` is the only thing naming a provider. `src/model.ts` maps a known prefix (`anthropic`) to that provider,
so `anthropic/claude-sonnet-5-5` needs `ANTHROPIC_API_KEY`; a prefix it does not
know goes to the AI SDK's default provider, the gateway, which needs
`AI_GATEWAY_API_KEY`.

A suite's verdict is an exact sign test over its non-tied pairs: BETTER or WORSE
at p < 0.05, otherwise NO DIFFERENCE FOUND. It is also WORSE when the candidate's
handledWhen pass rate drops significantly (one-sided Fisher exact on the
per-attempt pass counts), because a failure both arms share reads as a tie in the
pairwise comparison.

The exact tests cannot reach p < 0.05 from a single case's three attempts (three
of three is p = 0.125), which is the honest reading of that little data. A suite
with one case reports NO DIFFERENCE FOUND however lopsided it looks.

## A failed run is never graded

The judge compares two outputs. A run that threw has none, so a pair with a
failed run on either side never reaches the grader: it is counted as **not
judged** and annotated on its case. Grading the marker
`[the run failed: ...]` instead reads the arm that ran as the better one, which
is how a candidate whose routes were not deployed yet scored 18-0 for a degraded
build (PR #3926).

A suite with no judged pairs, or with more than half of them not judged, is
**CAN'T JUDGE**: its votes are the minority of its attempts, so reading a
direction off them claims more than the run saw. The preflight asks each arm for a run ID no arm can hold
(`GET .../v1/agents/runs/<random uuid>`). Its guard answers 401, or its handler
answers 404 for the missing run. Nest's `Cannot GET ...` 404 instead fails the
suite before a single agent run or grading call is spent.

## Debugging a CAN'T JUDGE

1. Read the job summary's **Not judged attempts** table. Each row is one
   attempt that never became a pair: which side failed (`base`, `candidate`, or
   `grader`), its run IDs with status, and the error.
2. `base`/`candidate` with no runs: the arm failed before `runAgent`, so at
   test-user setup. Search that arm's gp-api logs for the 500 (e.g. `POST
/v1/elected-office`).
3. `base`/`candidate` with a run: look the run ID up in that arm's logs or its
   `experiment_run`/agent-run row. `superseded` means a deploy requeued it.
4. `grader`: the judge model's answer failed the grading schema or the call
   errored. Rerun one case locally (`-t <case>`) with base and candidate both set
   to the same URL to separate the grader from the arms, and catch
   `NoObjectGeneratedError` for `.text` and `.cause` to see the raw answer.
5. Full per-run records are the `pairwise-run` annotations, printed by the
   default reporter on a local run; CI does not keep them.

Run evals from a worktree, not the main checkout: `vite-tsconfig-paths` walks
every `.worktrees/*` tsconfig there and fails to resolve them.

## Signing in

`@goodparty_org/test-users` creates the user, the campaign or elected office, and
the org through the API before anything else. `CLERK_SECRET_KEY` is the dev Clerk
instance secret; Clerk's Backend API budget is 100 requests per 10 seconds per
instance, shared with the e2e suite and gp-api's own lookups, so use Vitest's worker and concurrency limits when sharing that budget.

## Chat agents

A chat agent has no run route, so `ctx.runAgent` does not reach it. `chatTurns`
posts the case's turns to the conversation it opened as the case's own test user
and returns the transcript; `briefingChatTurns` does the same for
`briefing_annotation`, whose conversation is created with the annotation it
hangs off. The turn's reply is the SSE body, so `ctx.postEventStream` reads it as
text: through `ctx.api.post` axios would try the whole body as JSON and hand back
an object for any single frame that happened to parse. A reply that streamed an
`error` frame or ended without `done` is a thrown turn, not a subject for
grading.

## Tests

`src/*.test.ts`, Vitest. A fake model (`generateObjectFn`, or a
`MockLanguageModelV3` for the real `generateObject`) and fake transports stand in
for the provider and the two arms; nothing here touches a network.

`src/expectedResult.test.ts` drives the expected-result helper through fake
Vitest globals and a fake model, so it covers the registration, the three
attempts, the annotations and the `JUDGE_MODEL` failure without a provider.
