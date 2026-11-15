# CAP consolidation: every agent in gp-api

The plan for moving every in-product agent into gp-api, on one engine.
ClickUp ticket 17tnw2b5rd0, "Consolidate In-Product Agent Architecture".
Until an agent moves, it runs as [`cap-background-agents.md`](cap-background-agents.md)
describes; chat runs as [`cap-interactive-agents.md`](cap-interactive-agents.md) describes.

## v1 architecture

- **One app.** Every agent, chat and background, runs inside gp-api on the
  Vercel AI SDK. Chat already runs there and stays on today's path.
- **A definition** holds Zod input and output schemas, one model line, a
  prompt file in the repo, its tools, and `onArtifact`, a function that
  saves the validated output where the product reads it:
  `defineAgent({ input, output, model, prompt, tools, onArtifact })`.
  Agents are listed in a registry next to `jobs.registry.ts`.
- **Starting a run.** `AgentsService.run(name, input)` is the only way in.
  Every agent shares one pg-boss queue, `agentRun`, with one fleet-wide cap.
- **A run is one conversation.** One `ChatConversation` per run; each
  completed model step is a `ChatMessage` row with its tool results and
  token counts. A run has a step budget.
- **Resume.** A deploy stops the run after its current step and requeues
  the job. The retry loads the saved steps and calls the loop again. Work in
  flight when the task dies is redone.
- **Shape changes.** A run is stamped with a hash of its agent's output
  schema. A resume under a different hash supersedes the run and starts a
  fresh one. Prompts, tools and models change freely.
- **Output.** The model calls `submitOutput`; Zod checks it and returns
  short errors on a miss.
- **Web access.** TypeScript tools in gp-api, added as agents need them:
  search, plain HTTP fetch and link check first. AgentCore Browser only for
  an agent that needs a real browser. No shell, no broker.
- **Observability.** Spans to Grafana Agent Observability, no prompt text.

## Migration plan

1. **Core.** The engine above in gp-api, with no agent on it yet.
2. **Community issues first** (`top_community_issues`, `trending_issues`),
   as the template for every later agent: the definition, the smallest web
   tool set it needs, the judge's in-process arm for it, and a per-agent
   switch in gp-api that sends dispatch to the old engine or the new one,
   default old.
3. **One agent at a time.** An agent's switch flips only after the
   universal judge says the new engine is the same or better, with both
   sides reading the same recorded pages. Flipping marks that agent's
   in-flight old runs `SUPERSEDED`, so a late old result is ignored.
   Rollback is the switch.
4. **Meeting briefings later.** Its orchestration is the most complex.
5. **Teardown** once every switch points at gp-api: stop dispatch, drain,
   then delete the SQS queue, dispatch Lambdas, DynamoDB job table, Fargate
   runner, broker, S3 manifests and the Python agent packages. A check
   fails while any switch still points at the old engine.

## Deferred

- **Multi-stage agents and subagents.** Nothing multi-stage until every
  background agent has moved. Decomposition after that is subagents, not
  stages.
- **A worker service for agents** (the same image, running only agent
  workers), once agent load measurably slows the API.
- **AI SDK 7** (draft #3707).
- **Chat on the agent registry.** Briefing chat and the other scopes stay
  on today's chat path.

## Decisions

| Record                                                                                             | Rule                                                   |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [AI SDK, not LangGraph](adr/2026-11-15-agents-run-on-the-ai-sdk-not-langgraph.md)                  | Every agent's loop is the AI SDK                       |
| [One chat conversation per run](adr/2026-11-15-agent-run-is-one-chat-conversation.md)              | Completed steps are `ChatMessage` rows; resume reloads |
| [pg-boss jobs in gp-api](adr/2026-11-13-agent-runs-are-pg-boss-jobs-in-gp-api.md)                  | One `agentRun` queue, one cap; not Lambda              |
| [Shape change supersedes](adr/2026-11-15-agent-shape-change-supersedes-the-run.md)                 | Hash the output schema; no agent versions              |
| [One conversation, no stages](adr/2026-11-14-background-agent-is-one-conversation-no-stages.md)    | Subagents later, rows tagged by `agent`                |
| [submitOutput](adr/2026-11-14-agents-return-output-through-submit-output.md)                       | Not the SDK's structured output                        |
| [No shell, web tools in TypeScript](adr/2026-11-13-agents-get-no-shell-web-tools-in-typescript.md) | Broker removed; AgentCore Browser when needed          |
| [Grafana Agent Observability](adr/2026-11-13-agent-traces-in-grafana-agent-observability.md)       | Spans with no prompt text                              |

## Background

- Design notes, the problems against four solutions:
  https://agent-consolidation-sub-problems.artifacts.goodparty.org
- Prototypes, never merged: #3828 (AI SDK, one conversation per run, the
  reference for v1), #3812 (AI SDK with stages), #3798 (LangGraph).
