# CAP consolidation: every agent in gp-api

The plan for moving every in-product agent into gp-api, on one engine.
ClickUp ticket 17tnw2b5rd0, "Consolidate In-Product Agent Architecture".
Status: in progress. The core, `AgentMessage` and `trending_issues` are on
main. `deploy/agentsOnGpApi.ts` says which agents run on gp-api's engine in
which environment, and it is the only statement of that: a preview names
every registered agent, because a preview is the Universal Judge's candidate
arm. An agent a list leaves out runs in that environment as
[`cap-background-agents.md`](cap-background-agents.md) describes; chat runs
as [`cap-interactive-agents.md`](cap-interactive-agents.md) describes.

## v1 architecture

- **One app.** Every agent, chat and background, runs inside gp-api on the
  Vercel AI SDK.
- **A definition** holds Zod input and output schemas, one model line, a
  prompt, its tools and `onArtifact`, a function that saves the validated
  output where the product reads it (it can run twice, so it must be
  idempotent):
  `defineAgent({ input, output, model, prompt, tools, onArtifact })`.
  `tools` is a map keyed by tool name. Each tool is
  `defineTool({ description, input, execute(input, ctx) })`, where `ctx`
  carries the run id, the organization, an abort signal and service lookup.
  Agents share a tool by importing it.
- **Starting a run.** `AgentsService.run(name, input)` is the only way in.
  Every agent shares one pg-boss queue, `agentRun`, with one fleet-wide cap
  of 100 running runs, and each task gets that many slots, so the cap alone
  decides (`docs/adr/2026-11-19-the-agent-run-cap-is-the-cap-per-task.md`).
  A run that fails its last attempt dead-letters, which alerts like any
  other job.
- **Storage.** Two parents, one message table:
  - `AgentMessage`: one row per message for every agent, chat and
    background. It belongs to exactly one parent, a `ChatConversation` or an
    `AgentRun`. Each row has an `index`, a `role` (user, assistant or tool)
    and `parts` (the AI SDK message content). Assistant rows carry the model
    and their input, output, cache-read and cache-write token counts.
  - `AgentRun`: a background run. Its agent, organization, status (queued,
    running, completed, failed, superseded), manifest, shape hash, input,
    accepted artifact and error.
  - `ChatConversation` stays the chat parent.
  - No cost is stored. Spend is computed from stored tokens.
- **A run is one long conversation.** Its input is the first user message;
  nudges are user messages. Only completed messages are saved. A run has a
  step budget.
- **Resume.** A deploy stops the run after its current step and requeues the
  job without spending an attempt. The retry loads the run's messages and
  calls the loop again. Work in flight when the task dies is redone.
- **Shape changes.** A run's manifest is its input and output schemas, and
  its shape hash is a hash of the manifest. A resume under a different hash
  marks the run superseded and starts a fresh run from the same input.
  Prompts, tools and models change freely.
- **Output.** The model calls `submitOutput`, whose input is the output
  schema. Zod checks it and returns short errors on a miss. The accepted
  output is saved on the run, then `onArtifact` runs, then the run is
  completed. A run that stops without an accepted output fails.
- **Web access.** TypeScript tools in gp-api: Brave web search, plain HTTP
  fetch and link check first. AgentCore Browser only for an agent that needs
  a real browser. No shell, no broker, no provider-native web search.
- **Observability.** Chat and background spans go to Grafana Agent
  Observability. Prompt and reply text stay off.

## Migration plan

In this order. A step starts when the one before it is done. Step 1's bar was
successful production traffic; a migration's is the judge verdict and approval
on its own PR, which arrive before the merge (step 3).

1. **`trending_issues` live in prod.** The template for every later agent:
   the definition, its web tools, its judge suite, and the
   `AGENTS_ON_GP_API` switch. The switch is a plain environment variable in
   the task definition, not a secret: `environmentVariables` in
   `packages/gp-api/deploy/index.ts` sets it from `deploy/agentsOnGpApi.ts`, so
   a flip is one reviewed line. `runsOnGpApi` reads it, and an agent it does
   not name runs on the PMF Engine. A preview names every
   agent in the registry, never a subset: the
   judge's candidate arm is a preview, and an agent a preview left out would
   run the PMF Engine on both arms
   ([`agent-evals.md`](agent-evals.md)).
   Done when prod runs complete, land on the dashboard, never re-dispatch,
   never dead-letter, and show in Grafana Agent Observability.
2. **Every chat agent on `AgentMessage` in prod.** ✅ Every chat scope reads
   and writes only `AgentMessage`: the client supplies each user message's id
   (a UUID, so a retry is caught by the primary key), and a rating names the
   `AgentMessage` turn it was left on. Nothing uses `ChatMessage` or
   `ChatMessageSegment`, and #3893 drops both tables, staged a deploy later so
   no task serving during that rollout was still reading them.
3. **The remaining background agents, in waves.** One migration is one PR:
   the agent, its readers, its judge suite (see
   [Writing agent evals](agent-evals.md)), its `qa/` manifest deleted, and its
   entry in the preview, dev and prod lists in `deploy/agentsOnGpApi.ts`.
   While that PR is open, dev still runs `main`'s lists, so a `/judge-eval` on
   it compares the PMF Engine in dev against the PR's preview on gp-api's
   engine. That verdict, and Delegate's approval of it, is the proof, and
   promoting the PR is the migration. Rollback is reverting the PR's list
   lines, which restores the old engine only if the agent's readers can read
   that engine's runs. They cannot as the switch is written: a gate asks which
   run this org already has by org, agent type and status, and reads one table,
   so a reader on one engine cannot see a run the other engine stored — after a
   revert it finds nothing and dispatches a second run. `meeting_schedule`'s
   dispatch gate and latest-schedule read were in that shape, and now read both
   tables: the gate checks both, and the latest-schedule read takes whichever
   engine's newest completed run is later, so a flip cannot serve the other
   engine's older schedule. So a migration makes its readers two-way first: the
   gate and the latest-run read check both tables by org and type, and a by-id
   read falls through to the other table, as the judge's read route does. That
   is the one place a migration departs from the readers already in, and it is
   the migration author's to do — no check tests a revert, because the judge
   verdict does not.
   CI's per-case results are in the `judge-eval-results` artifact
   ([`judge/AGENTS.md`](../packages/judge/AGENTS.md)).
   - **Wave 1, web tools only:** `race_opponent_summary`,
     `opposition_research`, `opportunities_and_challenges`,
     `race_opponent_collection`, `self_research`, `meeting_schedule`.
     `opposition_research`, `opportunities_and_challenges` and
     `meeting_schedule` are in the preview and dev lists and run on gp-api's
     engine in both; prod still runs them on the PMF Engine, and a promote PR
     moves them there once their dev runs are healthy. Nothing else in this
     wave is migrated. The opponent chain runs collection, then summary, then
     actions, and one chain is one migration: collection and summary land with
     actions, in the PR that puts all three in every list.
   - **Wave 2, needs a Databricks tool:** `race_opponent_actions`,
     `opponent_research`, `top_community_issues` (on gp-api's engine in
     preview and dev; prod is still on the PMF Engine), `campaign_tracker_tasks`.
     The tool exists: `queryDatabricks`
     (`packages/gp-api/src/agents/tools/queryDatabricks.ts`) runs one
     aggregate-only SELECT under the agent's own table allowlist and row cap,
     refuses a query that does not prove the run's own state filter (and its
     district's, when the office has one) in every WHERE, and drops any cell
     below 100.
   - **Wave 3, its own design each:** `find_existing_ordinances` (PDF
     reading, the code-capture files, the heaviest traffic),
     `meeting_briefing` (document reading and search, uploaded agendas),
     `compliance_setup` (buys domains and submits to Peerly, so it must be
     idempotent before it moves; last).
   - **Delete, not migrate:** `district_issue_pulse` and
     `district_issue_snapshot` (nothing dispatches them), and every `qa/`
     checker.
4. **Teardown** once the prod list names every agent: delete the SQS queue,
   dispatch Lambdas, DynamoDB job table, Fargate runner, broker, S3
   manifests, the Python agent packages, `ExperimentRun` and its readers, and
   the leftover price tables.
5. **Docs.** Every PR keeps the docs it touches current. Last, one pass
   deletes this file and the old-engine docs and rewrites the agent docs to
   describe the system as it is. The repo should end with less agent
   documentation than it started with.

## Deferred

- **Multi-stage agents.** Nothing multi-stage in v1. Nothing in v1 should
  stop loops being wired together later.
- **A worker service for agents** (the same image, running only agent
  workers), once agent load measurably slows the API.
- **AI SDK 7.**

## Decisions

Each decision gets a record in [`adr/`](adr/), landing with the PR that
builds it.

| Record                                                                       | Lands with   |
| ---------------------------------------------------------------------------- | ------------ |
| Every agent runs its model loop on the Vercel AI SDK, not LangGraph          | Core PR      |
| Agent runs are pg-boss jobs inside gp-api                                    | Core PR      |
| `AgentRun` and `AgentMessage` store a run                                    | Core PR      |
| A resumed agent run whose agent changed shape is superseded and started over | Core PR      |
| A background agent is one long conversation                                  | Core PR      |
| Agents return their output through a submitOutput tool                       | Core PR      |
| Agent spend is stored tokens, not a price                                    | Core PR      |
| Agent traces go to Grafana Agent Observability, with no prompt text          | Core PR      |
| Agent web search is Brave, in TypeScript                                     | Core PR      |
| Agents get no shell, and web access is TypeScript tools in gp-api            | Migration PR |

## Background

- Design: https://agent-consolidation-sub-problems.artifacts.goodparty.org
  (storage schema at `/storage-schema.html`).
