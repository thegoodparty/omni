---
title: An AgentRun records a background run; AgentMessage records every message
status: active
decided_by: [swain]
date: 2026-11-15
code: ['#3835']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-api/prisma/schema/agentRun.prisma
  - packages/gp-api/prisma/schema/agentMessage.prisma
supersedes: []
superseded_by:
---

# An AgentRun records a background run; AgentMessage records every message

## Decision

Two tables, and every agent — chat and background — stores its messages in
the one message table.

`AgentRun` is the parent of a background run: `agentName`,
`organizationSlug` (the owner, cascading), `status`
(`queued | running | completed | failed | superseded`), `manifest` (the input
and output schemas as they were at run start) and `shapeHash`, `input`,
`artifact` (the accepted output), `error`, `startedAt`, `finishedAt`.

`AgentMessage` is one row per message of any agent, chat or background: an
`index` unique within its parent, `role` (`user | assistant | tool`), `parts`
(the AI SDK message content: text, tool calls, tool results), and `model`
plus `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` on
`assistant` rows, which are exactly one model call each. Exactly one parent
is set — `conversationId` for a chat or `agentRunId` for a background run —
enforced by the `agent_message_one_parent` CHECK.

`ChatConversation` stays the chat parent: it has no status, failure or
artifact.

## Context

The first build of this PR recorded a run as an `ExperimentRun` and its steps
as `ChatMessage` rows in a `background_agent`-scoped conversation. That shared
a table with the PMF Engine, whose columns a gp-api run does not have and
would have to fake, and it stored the steps in a shape chat did not use — so
every consumer needed two paths, and the two drifted. Storing foreground and
background the same way is the point of consolidating: one resume, one token
accounting, one span vocabulary, and the chat migration that follows is a
writer change, not a second schema. The review asked for exactly this: don't
prescribe an ExperimentRun, and don't record foreground and background
differently.

A background run's messages are also not a chat: no user starts it, nothing
edits or deletes one, and its history is what a retry resumes from, so it
needs an order that never depends on timestamps.

## Alternatives rejected

- **A run as an `ExperimentRun`**: the PMF Engine's table, its columns and its
  readers, for a producer that shares none of its lifecycle.
- **Run columns on `ChatConversation`** (#3828): nine columns for a status
  and an output on a table whose other rows are chats, and no place for the
  run's own lifecycle.
- **A separate message table for background runs**: two shapes for the same
  thing, which is the drift this consolidation exists to end.
- **`ChatMessage` for both**: a text column plus display segments drops tool
  results and provider metadata a resume needs.
- **Ordering by `createdAt`**: two rows written in one step share a
  timestamp, and a resume must not depend on a tiebreak.

## Revisit if

A second message-shaped thing needs its own parent (subagents, per the
no-stages record): it joins `AgentMessage` with a tag, not a new table.
