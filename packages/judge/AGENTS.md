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

## The run

`/judge-eval <suites>` on a PR, or `.github/workflows/judge-eval.yml` by hand.
Base is `https://dev.goodparty.org`, candidate is the PR's **webapp** preview,
whose `NEXT_PUBLIC_API_BASE` is that PR's gp-api preview. Neither needs a key of
its own.

```bash
npx tsx packages/judge/src/run.ts \
  --base https://dev.goodparty.org \
  --candidate https://pr-3904.preview.goodparty.org \
  --suite trending_issues \
  --judge-model anthropic/claude-sonnet-4-6 \
  --out ./judge-results
```

| File              | What                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/suite.ts`    | `definePairwiseAgentEvalSuite`, `EvalContext`, `Case`, `grading`                                                  |
| `src/arm.ts`      | One arm of one attempt: a fresh test user, its org, `ctx`, `probeArm`                                             |
| `src/apiRoot.ts`  | Whether an arm is a webapp (gp-api at `/api`) or a gp-api origin (`/v1`); a URL neither answers for is not an arm |
| `src/runAgent.ts` | The two agent routes, and the poll                                                                                |
| `src/execute.ts`  | One shared pool: six runs per case, a pair graded as soon as both sides land                                      |
| `src/grade.ts`    | The grading call, through the AI SDK's `generateObject`                                                           |
| `src/stats.ts`    | The exact sign test and the handledWhen test                                                                      |
| `src/report.ts`   | `results.json` and `results.md`                                                                                   |
| `src/cli.ts`      | Flags                                                                                                             |
| `src/discover.ts` | The `packages/gp-api/src/**/*.eval.ts` glob                                                                       |
| `src/run.ts`      | The command                                                                                                       |

## The grader

One pair per attempt, three pairs per case. Each pair is judged in **both
orders** — base as A and candidate as B, then swapped — and two orders that
disagree are a tie. One `generateObject` call returns the winner, `handledWhen`
as yes/partly/no per side, a 1-5 score per dimension, and one sentence of
reasoning. Default questions: `task_success`, `instruction_adherence`,
`user_utility`; a case's `grading.dimensions` adds to them.

`generateObject` from `ai` with a Zod schema — never a provider SDK — so
`--judge-model` is the only thing naming a provider and swapping providers is a
flag change. `src/model.ts` maps a known prefix (`anthropic`) to that provider,
so `anthropic/claude-sonnet-4-6` needs `ANTHROPIC_API_KEY`; a prefix it does not
know goes to the AI SDK's default provider, the gateway, which needs
`AI_GATEWAY_API_KEY`.

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
