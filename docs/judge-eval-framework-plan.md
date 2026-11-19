# Judge eval framework: build plan

The plan for replacing the universal judge's runners with a small eval
framework, so every background agent can be judged quickly while it moves onto
gp-api's own agents ([`cap-consolidation.md`](cap-consolidation.md)). Status:
phases 1 to 3 in this PR.

## Why

A sweep takes about 35 minutes, and most of the judge's 24,000 lines exist to
run agents: S3 staging, SQS dispatch, fixture identifiers, one worktree and
one process per arm, arm budgeting, page replay. Every migration PR needs a
fast, trustworthy "new engine on this branch is the same or better than the
old engine on main". This framework is that check.

## The framework

The judge is a small test framework, like Vitest for agents.

| Vitest          | Here                                               |
| --------------- | -------------------------------------------------- |
| Test file       | **Suite**: one agent experience                    |
| `it(...)`       | **Case**: one scenario with an input               |
| `beforeEach`    | **Setup**: state a case needs first                |
| Code under test | **Run**: drives the agent, returns text            |
| `expect(...)`   | **Grading**: the judge compares base and candidate |

```ts
type EvalContext = {
  api: AuthedFetch // signed in as this run's test user; paths relative to baseUrl
  baseUrl: string // dev (base arm) or the PR preview (candidate arm)
  // The org bootstrap created for this run's test user. Every run gets a new
  // user and so a new org; nothing has to create one.
  org: { slug: string }
  runAgent: (name: string, input: unknown) => Promise<AgentRunResult>
}

definePairwiseAgentEvalSuite<Input>(name, {
  mode: 'win' | 'serve', // which kind of test user a case needs
  profile: Profile, // name, office, district, race: the same for a case's 3 attempts
  run: (input: Input, ctx: EvalContext) => Promise<string>,
  cases: Case < Input > [],
})

type Case<Input> = {
  id: string
  input: Input
  setup?: (ctx: EvalContext) => Promise<void>
  grading?: {
    condition?: string // what is special about this case
    handledWhen?: string // a pass/fail rule checked on each run
    dimensions?: Record<string, string> // extra questions, name to question
  }
}
```

Rules:

- **Every case runs 3 times on each side.** Not configurable.
- **Every run gets a new test user.** All three attempts, on each side, so
  each starts from a clean slate. The three attempts of one case share the
  suite's profile, so only the identity is new and the attempts stay
  comparable.
- **Output is a string**: the exact text the judge reads. A background suite
  serializes its artifact.
- **Cases are TypeScript**, in `<agent>.eval.ts` beside the agent. The
  suite's input type checks every case. No JSON case files.
- **Setup goes through public routes, or runs another agent.** It never writes
  rows directly. A case whose state no route and no agent can create is not
  written yet.
- **The judge talks only to a base URL and a candidate URL.** It imports no
  gp-api code and holds no AWS, S3, SQS or Databricks access. It holds a
  judge-model key and a way to sign in a user. Either URL may be a webapp that
  proxies gp-api at `/api` or a gp-api origin that serves `/v1` itself; which
  one is a property of the URL, resolved once per arm.
- **No page replay and no pinned data version.** Both arms run at the same
  time, so the web and the voter mart are the same for both.

## How it runs

```
npx tsx packages/judge/run.ts \
  --base https://dev.goodparty.org \
  --candidate https://pr-3904.preview.goodparty.org \
  --suite trending_issues \
  --judge-model anthropic/claude-sonnet-4-6 \
  --out ./judge-results
```

| Input                              | What it is                                             |
| ---------------------------------- | ------------------------------------------------------ |
| `--base`                           | the base arm's URL: dev, running main                  |
| `--candidate`                      | the candidate arm's URL: a PR preview                  |
| `--suite`                          | suite names, comma-separated, or `all`                 |
| `--judge-model`                    | an AI SDK model id, e.g. `anthropic/claude-sonnet-4-6` |
| `--out`                            | where `results.json` and `results.md` are written      |
| `--concurrency`                    | cases in flight at once, default 16                    |
| the judge model provider's API key | in that provider's standard environment variable       |

It loads suites from the checkout it runs in, and imports nothing else from
gp-api: the two URLs are the whole of its input.

**Locally**, the same command with `--candidate http://localhost:3000`, or a
preview URL, and an `--out` in the working tree.

**In CI**, `judge-eval.yml` waits for the preview, runs the command, and posts
`results.md` as the PR comment. `/judge-eval <suites>` triggers it. It is a
workflow of its own rather than a mode of `judge.yml`, because the old judge
still drives chat suites and has to keep working untouched.

**Flow.** For every case and its three attempts, base and candidate run at
once in one shared pool: sign in, setup, run, keep the output string. A pair
is graded as soon as attempt N exists on both sides, so grading overlaps the
runs still landing. At the end the process writes `results.json` and
`results.md`.

### Signing in

A run needs a real signed-in user, and gets a new one every time. In
`packages/gp-webapp/e2e-tests/tests/utils/api-registration.ts`,
`bootstrapTestUser` creates a real Clerk user with the backend SDK, calls
`mintApiToken` for a one-hour API token, then provisions the user through the
API before any browser session, every Clerk call through `clerkThrottle`.
Those are `@test.goodparty.org` users, and gp-api's `sweepTestUsers` deletes
them after three hours.

`bootstrapTestUser` is module-private and takes a Playwright `Page` for the
sign-in it does at the end; the part the judge needs is everything before
that. Extract it into a package both the judge and the e2e suite import, or
copy it.

**The org comes with the user.** Bootstrap creates it: a campaign for a Win
suite, an elected office for a Serve suite, as the e2e helpers already do
(`bootstrapTestUser` creates a campaign, `seedPrefilledElectedOffice` in
`packages/gp-webapp/e2e-tests/src/helpers/serve.helper.ts` creates the
office). So no run needs an org route, and `ctx.org` is just that user's org.
A suite declares which kind it needs with `mode`, and gives its cases one
`profile` — name, office, district, race — so that a case's three attempts
run as three identities with the same profile.

It needs `CLERK_SECRET_KEY` for the dev Clerk instance. Clerk's Backend API
budget is 100 requests per 10 seconds per instance, shared with every other
process holding that secret — the e2e suites, gp-api's own provisioning
lookups, the test-user sweep — which is one reason `--concurrency` is capped.

## One way to run any background agent

```
POST /agents/:name/runs   { input }  -> { runId }
GET  /agents/runs/:runId             -> { status, artifact, error }
```

- **Dev and previews only.** Not mounted in prod.
- **Any background agent, either engine.** The route dispatches through the
  same per-agent switch the product uses (`runsOnGpApi`): gp-api's agents
  when the switch is on, the PMF Engine otherwise. `GET` reads `AgentRun` or
  `ExperimentRun` and returns the artifact the same way for both, so the
  judge never touches S3.
- **Signed-in user who belongs to the org**, like any other org route.

This is what makes a migration PR judge itself:

| Arm       | Where             | Engine for the agent being migrated                |
| --------- | ----------------- | -------------------------------------------------- |
| Base      | dev, running main | PMF Engine (its switch is off on dev)              |
| Candidate | the PR preview    | gp-api (previews switch on every agent gp-api has) |

That works only for an agent gp-api already has. One gp-api has not built yet
runs the PMF Engine on **both** arms, so the suite would compare PMF-Engine
output with itself and pass. Build the gp-api agent first, then the suite.

`ctx.runAgent` is the only background helper. There is no separate legacy
helper: the route picks the engine. After an agent's switch flips on dev,
both arms run gp-api's engine and the same suite keeps judging later changes.

**Limit while an agent is still on the PMF Engine:** a branch that edits that
agent's Python instruction is not seen by the preview, which dispatches the
manifest published from main. Judge Python-prompt edits on the old judge
until that agent migrates, or not at all.

## Phases

Each phase is one PR, driven to delegate approval with every check green.

### 1. The run routes

- `POST /agents/:name/runs` and `GET /agents/runs/:runId` in gp-api, as above.
- Previews set `AGENTS_ON_GP_API` to every agent in the registry
  (`packages/gp-api/deploy/index.ts`). This reverses "preview stays unset" in
  `cap-consolidation.md`; update that doc in the same PR.
- An ADR: the judge reaches agents only through a base URL.

### 2. The framework

- `definePairwiseAgentEvalSuite`, `EvalContext`, a test user per run (and so
  an org per run), and the `run.ts` command above.
- One runner process, one shared pool: for every case and attempt, base and
  candidate at once, each pair graded as soon as both sides land.
- A new `judge-eval.yml` of about 200 lines: wait for the preview, run the
  command, post `results.md`. `/judge` and `judge.yml` keep working.
- The old grader is not kept. The grader below is new and smaller, not
  `judge.ts`, `score.ts` and `report.ts` moved; the whole framework targets
  600 to 1,000 lines.
- `trending_issues` as the first suite: the one agent already running on
  gp-api in dev and prod, so both arms exercise the engine being kept.

#### The grader

One pair per attempt, three pairs per case. Each pair is judged in **both
orders** — base as A and candidate as B, then swapped — and two orders that
disagree are a tie. One grading call returns the winner, `handledWhen` as
yes/partly/no per side, a score per dimension, and one sentence of reasoning.

The call goes through the Vercel AI SDK — `generateObject` from `ai`, with a
Zod schema for the verdict — never a provider SDK, so `--judge-model` is the
only thing naming a provider and swapping providers is a flag change.

A suite's verdict is a sign test over its non-tied pairs: BETTER or WORSE at
p < 0.05, otherwise NO DIFFERENCE FOUND. It is also WORSE when the candidate's
`handledWhen` pass rate drops significantly. The migration gate is "not
WORSE".

The run writes `results.json` — every output, every judgment, tokens — and
`results.md`, and exits 1 on WORSE.

### 3. Every background agent's suite

Convert each background case list into a suite, with cases unchanged in
meaning. One PR per wave, matching the migration waves in
`cap-consolidation.md`:

- Wave 1: `race_opponent_summary`, `opposition_research`,
  `opportunities_and_challenges`, `race_opponent_collection`, `self_research`,
  `meeting_schedule`.
- Wave 2: `race_opponent_actions`, `opponent_research`,
  `top_community_issues`, `campaign_tracker_tasks`.
- Wave 3: `find_existing_ordinances`, `meeting_briefing`.
- Not converted: `district_issue_pulse` and `district_issue_snapshot` (to be
  deleted), and `compliance_setup` (blocked: it makes real purchases).
- Not converted for now: four of `meeting_briefing`'s cases (`a2-thin`,
  `a5-injection`, `a7-stale` and its control), because each one stages an
  agenda packet as a file and this framework supplies no input files. Without
  the packet the stressor is not in front of the run, so every pair ties. They
  come back when the framework can pass input files.

`top_community_issues` builds a suite in Wave 2 but cannot be judged until
its data-platform prerequisite lands: its lean annotation reads the `hs_*`
scores in the people marts, so its switch stays off everywhere until those
exist (`cap-consolidation.md`).

Background suites are judged only by the new framework once their wave lands.
The old runner stays for chat until the follow-ups below.

**Stop here.** At this point every background migration PR is judged by
`/judge-eval <suites>` in one run of about the length of one agent run.

## Follow-ups, not scheduled

- **Chat suites on the framework.** Convert the five chat case lists. A chat
  case's input is `{ turns: string[] }` through the public chat routes.
  Simulated tool failures and seeded transcripts go away. Coordinate with
  Danny first: the case scout's publisher appends to `cases/<agent>.json`,
  and the guard's picker and pricing read the old layout.
- **Briefing chat into the chats controller.** `briefing-chats` is the only
  chat with its own controller. Fold it into `chats` as a scope, so chat suites
  need one helper and every chat agent has one interface.
- **Delete the old judge.** Once chat suites land: the runners, arm worktrees,
  arm budgeting, page replay, `dataVersion.ts`, and the old `judge.yml`.
- **Simulated users.** Feasible: add a model to `EvalContext` to play the
  user. Not planned until a scripted conversation cannot catch a real problem.

## Open questions

- **Background cost.** Background cases go from 1 run per side to 3. Raise the
  guard's $50-per-PR cap when its pricing moves.
- **Dev agent capacity.** Both arms of a background sweep share dev's
  scheduler cap of 50 Fargate tasks while agents are on the PMF Engine.
