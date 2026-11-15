---
title: A background agent run is one chat conversation, and each completed step is a message row
status: active
decided_by: [swain]
date: 2026-11-15
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-api/prisma/schema/chatConversation.prisma
  - packages/gp-api/prisma/schema/chatMessage.prisma
supersedes: []
superseded_by:
---

# A background agent run is one chat conversation, and each completed step is a message row

## Decision

A background run's history lives in our chat tables. The run is one
`ChatConversation`; its input is the first `ChatMessage`; each completed
model step is one more `ChatMessage` row, written when the step ends, with
the messages the step added (tool results included) and its token counts.
The run record itself (status, input, cost) is the `ExperimentRun` the
conversation belongs to
(`2026-11-15-agent-runs-recorded-in-experiment-run.md`).

Resume is: the pg-boss retry loads the rows in order and calls the loop
again with them, about 30 lines. Only completed work is saved. A model call
or tool call still running when the task dies is lost and done again, so a
tool that writes keys its side effect on the run and the step.

## Context

The AI SDK saves nothing (`2026-11-15-agents-run-on-the-ai-sdk-not-langgraph.md`).
Chat already stores its turns in these tables. Every push to main deploys
gp-api, ECS kills a stopping task after 30 seconds, and a background run
takes 20 to 50 minutes, so many runs will cross a deploy. #3828 showed the
shape: a resume kill test stopped a run after 5 saved steps and a second
worker finished it on the same conversation.

## Alternatives rejected

- **LangGraph checkpoints.** Run state in blobs only LangGraph reads; see
  the AI SDK record.
- **New agent run and agent step tables.** A second copy of what
  `ChatConversation` and `ChatMessage` already model, and chat and
  background would drift apart.
- **Save tool calls in flight and resume inside them.** Every tool would
  have to be resumable. Redoing one step costs one model call.
- **Run state and artifacts in S3, as the PMF Engine does.** The agent
  runs in gp-api, so its `onArtifact` writes the product's own rows.

## Revisit if

Redone steps become expensive enough to show in cost, or a run's
conversation grows past what loading it on resume can carry.
