# Judge eval framework: build plan

The plan for replacing the universal judge's runners with a small eval
framework, so every background agent can be judged quickly while it moves onto
gp-api's own agents ([`cap-consolidation.md`](cap-consolidation.md)). Status:
not started.

## Why

A sweep takes about 35 minutes, and most of the judge's 24,000 lines exist to
run agents: S3 staging, SQS dispatch, fixture identifiers, one worktree and
one process per arm, arm budgeting, page replay. Every migration PR needs a
fast, trustworthy "new engine on this branch is the same or better than the
old engine on main". This framework is that check.

## The framework

The judge is a small test framework, like Vitest for agents.

| Vitest | Here |
| --- | --- |
| Test file | **Suite**: one agent experience |
| `it(...)` | **Case**: one scenario with an input |
| `beforeEach` | **Setup**: state a case needs first |
| Code under test | **Run**: drives the agent, returns text |
| `expect(...)` | **Grading**: the panel compares base and candidate |

```ts
type EvalContext = {
  api: AuthedFetch // signed in as this case's judge user; paths relative to baseUrl
  baseUrl: string // dev (base arm) or the PR preview (candidate arm)
  org: { slug: string } // a new org for this case and attempt
  runAgent: (name: string, input: unknown) => Promise<AgentRunResult>
}

definePairwiseAgentEvalSuite<Input>(name, {
  run: (input: Input, ctx: EvalContext) => Promise<string>,
  cases: Case<Input>[],
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
- **Output is a string**: the exact text the panel reads. A background suite
  serializes its artifact.
- **Cases are TypeScript**, in `<agent>.eval.ts` beside the agent. The
  suite's input type checks every case. No JSON case files.
- **Setup goes through public routes, or runs another agent.** It never writes
  rows directly. A case whose state no route and no agent can create is not
  written yet.
- **The judge talks only to a base URL.** It imports no gp-api code and holds
  no AWS, S3, SQS or Databricks access. It holds a model key for the panel
  and a way to sign in a user.
- **No page replay and no pinned data version.** Both arms run at the same
  time, so the web and the voter mart are the same for both.

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

| Arm | Where | Engine for the agent being migrated |
| --- | --- | --- |
| Base | dev, running main | PMF Engine (its switch is off on dev) |
| Candidate | the PR preview | gp-api (previews switch on every agent in the registry) |

`ctx.runAgent` is the only background helper. There is no separate legacy
helper: the route picks the engine. After an agent's switch flips on dev,
both arms run gp-api's engine and the same suite keeps judging later changes.

**Limit while an agent is still on the PMF Engine:** a branch that edits that
agent's Python instruction is not seen by the preview, which dispatches the
manifest published from main. Judge Python-prompt edits on the old judge
until that agent migrates, or not at all.

## Phases

Each phase is one PR, driven to delegate approval with every check green.

### 0. Concurrent grading

Grade every pair and every panel seat concurrently, capped at 16 model calls
(`judge.ts`, `config.ts`). The commit exists on branch `judge-speed-yml`
(`8e72c29a48`). It survives the refactor unchanged and cuts grading from about
9 minutes to about 1.

### 1. The run routes

- `POST /agents/:name/runs` and `GET /agents/runs/:runId` in gp-api, as above.
- Previews set `AGENTS_ON_GP_API` to every agent in the registry
  (`packages/gp-api/deploy/index.ts`). This reverses "preview stays unset" in
  `cap-consolidation.md`; update that doc in the same PR.
- An ADR: the judge reaches agents only through a base URL.

### 2. The framework

- `definePairwiseAgentEvalSuite`, `EvalContext`, a judge user and org per case
  and attempt.
- One runner process: for every case and attempt, base and candidate at once,
  each pair graded as soon as both sides land, reusing today's grading,
  scoring and report code.
- A new `judge.yml` of about 200 lines: wait for the preview, sign in, run,
  post the verdict comment. `/judge <agent>` keeps working.
- `trending_issues` and `top_community_issues` as the first two suites, since
  they already run on gp-api.

### 3. Every background agent's suite

Convert each background case list into a suite, with cases unchanged in
meaning. One PR per wave, matching the migration waves in
`cap-consolidation.md`:

- Wave 1: `race_opponent_summary`, `opposition_research`,
  `opportunities_and_challenges`, `race_opponent_collection`, `self_research`,
  `meeting_schedule`.
- Wave 2: `race_opponent_actions`, `opponent_research`,
  `campaign_tracker_tasks`.
- Wave 3: `find_existing_ordinances`, `meeting_briefing`.
- Not converted: `district_issue_pulse` and `district_issue_snapshot` (to be
  deleted), and `compliance_setup` (blocked: it makes real purchases).

Background suites are judged only by the new framework once their wave lands.
The old runner stays for chat until the follow-ups below.

**Stop here.** At this point every background migration PR is judged by
`/judge <agent>` in one run of about the length of one agent run.

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

- **Signing in against a preview.** Today a separate step mints a Clerk
  session from a checkout of main. Confirm a preview accepts that session,
  or use the M2M token if the run routes accept it for a named user.
- **Background cost.** Background cases go from 1 run per side to 3. Raise the
  guard's $50-per-PR cap when its pricing moves.
- **Dev agent capacity.** Both arms of a background sweep share dev's
  scheduler cap of 50 Fargate tasks while agents are on the PMF Engine.
