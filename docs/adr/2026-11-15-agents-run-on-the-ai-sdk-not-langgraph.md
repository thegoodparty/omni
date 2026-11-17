---
title: Every agent runs its model loop on the Vercel AI SDK, not LangGraph
status: active
decided_by: [swain]
date: 2026-11-15
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-api/src/llm/**
supersedes: []
superseded_by:
---

# Every agent runs its model loop on the Vercel AI SDK, not LangGraph

## Decision

Every agent, chat and background, runs inside gp-api on the Vercel AI SDK
(`ai`, `streamText` with tools). Chat already runs on it, so chat does not
migrate. The SDK saves nothing, so run state, resume and the deploy rule are
ours, each in its own record:
`2026-11-15-agent-run-and-agent-message-store-a-run.md`,
`2026-11-15-agent-shape-change-supersedes-the-run.md`.

## Context

Chat runs 5 scopes on AI SDK 6. The 16 background agents run in Python on
the Claude Agent SDK in Fargate (`docs/cap-background-agents.md`). Three
prototypes built the same meeting briefing agent: #3812 (AI SDK with our own
stage runner), #3798 (LangGraph with its Postgres checkpointer) and #3828
(AI SDK, one conversation per run). #3828 passed both kill tests (resume
after a deploy, start over after a shape change), wrote a live briefing in
8 steps, and came out 1,902 lines smaller than #3812.

No framework makes deploys safe for us. LangGraph applies the latest graph
to every resumed thread, so a removed or renamed node breaks runs in flight.
We would write our own shape rule on any path.

## Alternatives rejected

- **LangGraph with `PostgresSaver`.** It resumes mid-loop with no code of
  ours, but run state sits in serialized blobs only LangGraph decodes (no
  SQL, no columns of ours), checkpoints grow with run length and pruning is
  ours. Chat would move onto LangGraph threads, storing messages twice or
  reading history through the library, and LangChain model classes would
  replace AI SDK providers. Its strength, resuming inside a graph of stages,
  only matters for multi-stage agents, which we are not building.
- **Mastra.** Built on the AI SDK with plain tables, but restart recovery,
  the part we need most, was its newest and least settled (open Mastra
  issues 24592 and 24984, durable agents in beta). Its tracing and evals
  overlap Grafana and the universal judge.
- **AI SDK 7 `WorkflowAgent` on the self-hosted Postgres World.** A second
  job queue (graphile-worker) next to pg-boss, an HTTP route that ships with
  no authentication, unencrypted step data, and a migration on every deploy.
  Self-hosted, it replays new code against an old event log. Chat would
  keep a different run model.
- **AI SDK with our own stage runner (#3812).** The stage runner, routing
  and child conversations are the custom decomposition code we set out not
  to maintain.

## Revisit if

An agent needs durable multi-stage execution that subagents cannot give it,
or a durable runner on the AI SDK needs no second queue.
