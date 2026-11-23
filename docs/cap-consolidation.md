# CAP consolidation: every agent in gp-api

The plan for moving every in-product agent into gp-api, on one engine.
ClickUp ticket 17tnw2b5rd0, "Consolidate In-Product Agent Architecture".
Status: in progress. The core, `AgentMessage` and `trending_issues` are on
main; `trending_issues` runs on gp-api's own agents in dev and prod, and a
preview runs every agent gp-api has, because a preview is the Universal
Judge's candidate arm. `top_community_issues` runs on gp-api's own agents in
dev only, and prod still sends it to the PMF Engine until its dev runs are
confirmed healthy. Every other agent still runs on the PMF Engine in every
environment. Until an agent moves, it runs as
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

In this order. A step starts when the one before it is done, and done means
successful production traffic, not a merged PR.

1. **`trending_issues` live in prod.** The template for every later agent:
   the definition, its web tools, its judge suite, and the
   `AGENTS_ON_GP_API` switch. The switch is a plain environment variable in
   the task definition, not a secret: `environmentVariables` in
   `packages/gp-api/deploy/index.ts` sets it per environment, so the flip is
   one reviewed line. `runsOnGpApi` reads it, and unset means the PMF Engine.
   Dev's value landed with #3871, prod's with #3875. A preview names every
   agent in the registry (`deploy/agentsOnGpApi.ts`), never a subset: the
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
3. **The remaining background agents, in waves.** Each agent is one PR: its
   definition, its readers moved from `ExperimentRun` to `AgentRun`, its judge
   suite (see [Writing agent evals](agent-evals.md)), and its `qa/` manifest
   deleted. Flip its switch only after the dev versus preview comparison passes;
   CI's per-case results are in the `judge-eval-results` artifact
   ([`judge/AGENTS.md`](../packages/judge/AGENTS.md)).
   Rollback is the switch.
   - **Wave 1, web tools only:** `race_opponent_summary`,
     `opposition_research`, `opportunities_and_challenges`,
     `race_opponent_collection`, `self_research`, `meeting_schedule`. Not
     started. The opponent chain runs collection, then summary, then actions,
     and those three flip together, so collection and summary are built in
     wave 1 but wait for actions before they flip.
   - **Wave 2, needs a Databricks tool:** `race_opponent_actions`,
     `opponent_research`, `top_community_issues` (moved, dev),
     `campaign_tracker_tasks`. The tool exists: `queryDatabricks`
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
4. **Teardown** once every switch points at gp-api: delete the SQS queue,
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
