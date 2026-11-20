# Judge

`@goodparty_org/judge` — a small eval framework for background agents, like
Vitest for agents. It brings a base URL and a candidate URL into comparable runs
and grades the pairs.

Plan: `docs/judge-eval-framework-plan.md`. This package is phase 2.

## The shape

| Vitest          | Here                                                |
| --------------- | --------------------------------------------------- |
| Test file       | **Suite**: one agent experience (`<agent>.eval.ts`) |
| `it(...)`       | **Case**: one scenario with an input                |
| `beforeEach`    | **Setup**: state a case needs first                 |
| Code under test | **Run**: drives the agent, returns a string         |
| `expect(...)`   | **Grading**: the judge compares base and candidate  |

```ts
// packages/gp-api/src/<feature>/<agent>/<agent>.eval.ts
import type { AgentRunResult } from '@goodparty_org/judge'
import { definePairwiseAgentEvalSuite } from '@goodparty_org/judge'

export default definePairwiseAgentEvalSuite<{ organizationSlug: string }>(
  'trending_issues',
  {
    mode: 'serve',
    profile: { positionId: 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb24vMTczMjcw' },
    run: async (input, ctx) => {
      const run = await ctx.runAgent('trending_issues', input)
      return JSON.stringify(run.artifact)
    },
    cases: [
      {
        id: 'a-district-with-news',
        input: { organizationSlug: 'ignored-ctx-wins' },
        setup: async (ctx) => {
          await ctx.api.post('/v1/some-route', {})
        },
        grading: {
          condition: 'the district has recent local news',
          handledWhen: 'the output names at least one dated source',
          dimensions: { sourcing: 'Are the sources dated and checkable?' },
        },
      },
    ],
  },
)
```

A suite file may `import type` from gp-api and nothing else. The runner imports
no gp-api runtime code: the two URLs are the whole of its input.

## `EvalContext`

| Field                   | What                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`                   | `get`/`post`/`put`, signed in as this run's test user, scoped to its org, paths relative to the arm's API root                                                                                 |
| `baseUrl`               | the arm's root: dev for base, the PR's webapp preview for candidate. Its API root is resolved once (`src/apiRoot.ts`) — a webapp proxies gp-api at `/api`, a gp-api origin serves `/v1` itself |
| `org.slug`              | the org bootstrap created for this user. Nothing has to create one                                                                                                                             |
| `runAgent(name, input)` | `POST /agents/:name/runs` then poll `GET /agents/runs/:runId`. The route picks the engine, so a suite never knows which one ran                                                                |

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

## Suites

Thirteen, one per background agent, each beside the agent's own module:

| Suite                                                                                                              | Where                            |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `trending_issues`, `top_community_issues`                                                                          | `src/communityIssues/<agent>/`   |
| `race_opponent_summary`, `race_opponent_collection`, `race_opponent_actions`, `opponent_research`, `self_research` | `src/raceOpponent/`              |
| `opposition_research`, `opportunities_and_challenges`                                                              | `src/campaignStrategy/`          |
| `meeting_schedule`, `meeting_briefing`                                                                             | `src/meetings/`                  |
| `campaign_tracker_tasks`                                                                                           | `src/campaigns/campaignTracker/` |
| `find_existing_ordinances`                                                                                         | `src/ordinances/`                |

All paths are under `packages/gp-api/`. The five agents gp-api has not built yet
run on the PMF Engine, so their suite sits in the module that dispatches them.
`district_issue_pulse`, `district_issue_snapshot` (to be deleted) and
`compliance_setup` (makes real purchases) have no suite. The old JSON lists stay
under `src/chats/evals/judge/cases/` because the old runner still reads them for
chat and for the guards' pricing.

## Expected-result suites

The other kind of suite grades one run against a result a person already ruled
correct, rather than comparing two builds. Danny's case scout de-identification
evals are the first.

```ts
// packages/gp-api/src/<feature>/<thing>.eval.ts
import { defineExpectedResultEvalSuite } from '@goodparty_org/judge'

export default defineExpectedResultEvalSuite('case_scout_gate', {
  run: async (input, ctx) => {
    // Input is inferred from this parameter.
    await ctx.annotate(`gating ${input.draft.caseId}`, 'step')
    return gateDraft(input.draft, input.denylist, input.userMessages)
  },
  // ctx.input is the case's own input; ctx.judgeModel is the only model call.
  judge: async (output, ctx) => {
    const { containsPii } = await ctx.judgeModel(PiiSchema, prompt(ctx.input))
    return { passed: output.passed, containsPii }
  },
  cases: [
    {
      id: 'planted-name',
      input: { draft, denylist: [], userMessages: ['...'] },
      expected: { passed: false, containsPii: true },
    },
  ],
})
```

| Piece                            | What it is                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(input, ctx)`                | Drives the code under test. `Input` is inferred from this parameter, and `ctx.annotate` records a step                                                        |
| `judge(output, ctx)`             | Reads the run's output plus `ctx.input`. `Judgment` is inferred from its return type                                                                          |
| `ctx.judgeModel(schema, prompt)` | One `generateObject` call, returning what the schema parsed. The suite's whole model surface                                                                  |
| `cases`                          | `{ id, input, expected }`. One `test.concurrent` per case, three attempts each, and the case passes only when every attempt's judgment deep-equals `expected` |

`Input` and `Judgment` are inferred, so a case whose input does not fit `run`, or
whose `expected` does not fit `judge`, fails to compile.

**One file pattern, no registry.** Vitest finds `src/**/*.eval.ts` through
`packages/gp-api/vitest.evals.config.ts`. `npm run eval -w packages/gp-api` runs
it. `npm test` and `verify` do not: an eval spends real runs and model calls.

**Inputs are environment variables**, never flags. `JUDGE_MODEL` is an AI SDK
model id (`anthropic/claude-sonnet-5-5`) plus that provider's own key. A suite
whose judge never calls `judgeModel` needs neither; one that does calls it and
fails the test with a sentence naming `JUDGE_MODEL` when it is unset.

**Annotations are the report.** Every attempt records the case id, the run's
output (truncated to a few KB), the prompt summary and parsed answer of every
`judgeModel` call, the judgment, and expected-vs-actual on a mismatch. Nothing
written to an annotation may be a secret — a token, a key, a bypass secret — so
every message is redacted first, and a test scans a whole case's record for
token-shaped strings.

## The run

```bash
JUDGE_BASE_URL=https://gp-api-dev.goodparty.org \
JUDGE_CANDIDATE_URL=https://pr-3904.preview.goodparty.org \
JUDGE_MODEL=anthropic/claude-sonnet-5-5 \
npm run eval -w packages/gp-api -- trending_issues --reporter=default --reporter=../judge/src/reporter.ts
```

Set `CLERK_SECRET_KEY` and the model provider's key (e.g. `ANTHROPIC_API_KEY`)
in the environment. `JUDGE_CANDIDATE_URL` can also point to a local API.
Without either URL, pairwise suites skip and name the missing variables.
Set `JUDGE_REQUIRE_PAIRWISE=true` to make missing URLs fail instead.

Vitest discovers `*.eval.ts` and registers one concurrent test per pairwise
case. Each case runs three attempts on both arms with a fresh test user per
run. Each attempt is graded in both orders once its two outputs are ready.
An `afterAll` hook reads the suite verdict: WORSE and CAN'T JUDGE fail;
BETTER and NO DIFFERENCE FOUND pass. A case with no judged pairs also fails.
Test annotations capture redacted run excerpts and grading details. The current
run routes do not expose engine identity; annotations say `not reported`
when the response does not include it.

In CI, `/judge-eval <suites>` runs the selected pairwise suites after the PR
preview is ready. The reporter writes its verdict table to the GitHub job
summary (stdout locally); the PR comment links there. `/judge` and `judge.yml`
continue to drive chat suites separately.

| File                              | What                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| `src/pairwise.ts`                 | Suite registration, per-case execution, and verdict            |
| `src/suite.ts`                    | Suite definition types and validation                          |
| `src/arm.ts` and `src/apiRoot.ts` | Test-user context, API-root discovery, and run-route preflight |
| `src/runAgent.ts`                 | Agent run and polling routes                                   |
| `src/grade.ts` and `src/stats.ts` | Grading, exact sign test, and handledWhen regression test      |
| `src/reporter.ts`                 | Markdown verdict table                                         |

## The grader

One pair per attempt, three pairs per case. Each pair is judged in **both
orders** — base as A and candidate as B, then swapped — and two orders that
disagree are a tie. One `generateObject` call returns the winner, `handledWhen`
as yes/partly/no per side, a 1-5 score per dimension, and one sentence of
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

## Signing in

`@goodparty_org/test-users` creates the user, the campaign or elected office, and
the org through the API before anything else. `CLERK_SECRET_KEY` is the dev Clerk
instance secret; Clerk's Backend API budget is 100 requests per 10 seconds per
instance, shared with the e2e suite and gp-api's own lookups, so use Vitest's worker and concurrency limits when sharing that budget.

## Tests

`src/*.test.ts`, Vitest. A fake model (`generateObjectFn`, or a
`MockLanguageModelV3` for the real `generateObject`) and fake transports stand in
for the provider and the two arms; nothing here touches a network.

`src/expectedResult.test.ts` drives the expected-result helper through fake
Vitest globals and a fake model, so it covers the registration, the three
attempts, the annotations and the `JUDGE_MODEL` failure without a provider.
