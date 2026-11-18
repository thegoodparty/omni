# CAP consolidation: every agent in gp-api

The plan for moving every in-product agent into gp-api, on one engine.
ClickUp ticket 17tnw2b5rd0, "Consolidate In-Product Agent Architecture".
Status: in progress. Only the `AgentMessage` table is on main; no agent runs
on the new engine yet. Until an agent moves, it runs as
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
  Every agent shares one pg-boss queue, `agentRun`, with one fleet-wide cap.
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

1. **Core.** The engine above in gp-api, with no agent on it yet.
2. **Chat onto `AgentMessage`, every scope at once.** Chat writes both
   tables, a backfill converts existing conversations, a parity check
   compares them, and reads move behind the `chat-agent-message` flag. Then
   chat stops writing `ChatMessage`, and `ChatMessage` and
   `ChatMessageSegment` are dropped.
3. **Community issues first** (`trending_issues`, then
   `top_community_issues`) as the template for every later agent: the
   definition, the smallest web tool set it needs, the judge's in-process
   arm for it, and a per-agent switch in gp-api that sends dispatch to the
   old engine or the new one, default old.
4. **One agent at a time.** An agent's switch flips only after the universal
   judge says the new engine is the same or better, with both sides reading
   the same recorded pages. Rollback is the switch.
5. **Meeting briefings later.**
6. **Teardown** once every switch points at gp-api: delete the SQS queue,
   dispatch Lambdas, DynamoDB job table, Fargate runner, broker, S3
   manifests, the Python agent packages and `ExperimentRun`.

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
