---
title: A gp-api agent run is an ExperimentRun; its steps are a ChatConversation
status: active
decided_by: [agent]
date: 2026-11-15
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-api/prisma/schema/experimentRun.prisma
  - packages/gp-api/prisma/schema/chatConversation.prisma
  - packages/gp-api/prisma/schema/chatMessage.prisma
---

# A gp-api agent run is an ExperimentRun; its steps are a ChatConversation

## Decision

A background agent run inside gp-api (`src/agents`) is an `ExperimentRun`
row: `experimentType` is the agent's name, `params` its input, and status,
`error`, `costUsd` and `durationSeconds` are written the way the PMF
Engine's runs are. The run holds one `ChatConversation` (scope
`background_agent`, no owner, linked by `experimentRunId`) whose
`ChatMessage` rows are the completed steps, each with its AI SDK messages in
`step`. Only three columns are new: `experiment_run.shape_hash`,
`chat_conversation.experiment_run_id` and `chat_message.step`;
`chat_conversation.owner_user_id` becomes nullable.

## Context

Run state was already decided to live in the chat tables, one conversation
per run with only completed steps saved
(`2026-11-15-agent-run-is-one-chat-conversation.md`). The reference build
(#3828) put the run record on `ChatConversation` too, adding nine columns
(status, agent name, input, output, error, shape hash and its stamp time,
superseded by, judge replay) and a status enum. `ExperimentRun` already
has status, params, error, cost and the owning org, and gp-admin's agent
runs list and the products read it, so a run recorded there shows up where
every other agent run does, with no new reader.

## Alternatives rejected

- Run columns on `ChatConversation` (#3828): duplicates `ExperimentRun`, and
  gp-admin would need a second list for the same kind of thing.
- Conversation id equal to the run id, no link column: no foreign key, so
  deleting a run or its org would leave the steps behind.
- A run output column: the output is already in the last accepted
  `submitOutput` call in the steps, and `onArtifact` writes it where the
  product reads it.
- Steps as `ChatMessageSegment` rows: segments are display structure and
  drop tool results and provider metadata a resume needs.
- Owning the conversation with the org owner's user: a background run would
  count as that user's chat, and the user did not start it.

## Revisit if

Subagents arrive: their steps join the same conversation with an `agent`
column, which is the next column this design expects.
