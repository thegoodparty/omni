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

| Field                   | What                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `api`                   | `get`/`post`/`put`, signed in as this run's test user, scoped to its org, paths relative to `<baseUrl>/api`                     |
| `baseUrl`               | the arm's webapp root: dev for base, the PR preview for candidate                                                               |
| `org.slug`              | the org bootstrap created for this user. Nothing has to create one                                                              |
| `runAgent(name, input)` | `POST /agents/:name/runs` then poll `GET /agents/runs/:runId`. The route picks the engine, so a suite never knows which one ran |

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

## The run

```bash
npx tsx packages/judge/src/run.ts \
  --base https://dev.goodparty.org \
  --candidate https://pr-3904.preview.goodparty.org \
  --suite trending_issues \
  --judge-model anthropic/claude-sonnet-4-6 \
  --out ./judge-results
```

| File              | What                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `src/suite.ts`    | `definePairwiseAgentEvalSuite`, `EvalContext`, `Case`, `grading`             |
| `src/arm.ts`      | One arm of one attempt: a fresh test user, its org, `ctx`                    |
| `src/runAgent.ts` | The two agent routes, and the poll                                           |
| `src/execute.ts`  | One shared pool: six runs per case, a pair graded as soon as both sides land |
| `src/grade.ts`    | The grading call, through the AI SDK's `generateObject`                      |
| `src/stats.ts`    | The exact sign test and the handledWhen test                                 |
| `src/report.ts`   | `results.json` and `results.md`                                              |
| `src/cli.ts`      | Flags                                                                        |
| `src/discover.ts` | The `packages/gp-api/src/**/*.eval.ts` glob                                  |
| `src/run.ts`      | The command                                                                  |

## The grader

One pair per attempt, three pairs per case. Each pair is judged in **both
orders** — base as A and candidate as B, then swapped — and two orders that
disagree are a tie. One `generateObject` call returns the winner, `handledWhen`
as yes/partly/no per side, a 1-5 score per dimension, and one sentence of
reasoning. Default questions: `task_success`, `instruction_adherence`,
`user_utility`; a case's `grading.dimensions` adds to them.

`generateObject` from `ai` with a Zod schema — never a provider SDK — so
`--judge-model` is the only thing naming a provider and swapping providers is a
flag change. The provider's key goes in that provider's standard environment
variable.

A suite's verdict is an exact sign test over its non-tied pairs: BETTER or WORSE
at p < 0.05, otherwise NO DIFFERENCE FOUND. It is also WORSE when the candidate's
handledWhen pass rate drops significantly (one-sided Fisher exact on the
per-attempt pass counts), because a failure both arms share reads as a tie in the
pairwise comparison. The migration gate is "not WORSE"; the command exits 1 on
WORSE.

The exact tests cannot reach p < 0.05 from a single case's three attempts (three
of three is p = 0.125), which is the honest reading of that little data. A suite
with one case reports NO DIFFERENCE FOUND however lopsided it looks.

## Signing in

`@goodparty_org/test-users` creates the user, the campaign or elected office, and
the org through the API before anything else. `CLERK_SECRET_KEY` is the dev Clerk
instance secret; Clerk's Backend API budget is 100 requests per 10 seconds per
instance, shared with the e2e suite and gp-api's own lookups, which is why
`--concurrency` is capped.

## Tests

`src/*.test.ts`, Vitest. A fake model (`generateObjectFn`, or a
`MockLanguageModelV3` for the real `generateObject`) and fake transports stand in
for the provider and the two arms; nothing here touches a network.
