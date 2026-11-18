---
title: Chat moves to AgentMessage behind one global flag, then ChatMessage is dropped
status: active
decided_by: [swain]
date: 2026-11-17
code: ['#3862']
scope:
  - packages/gp-api/src/chats/**
  - packages/gp-api/prisma/schema/chatMessage*.prisma
  - packages/gp-api/prisma/schema/agentMessage.prisma
supersedes: []
superseded_by:
---

# Chat moves to AgentMessage behind one global flag, then ChatMessage is dropped

## Decision

Every chat scope moves from ChatMessage/ChatMessageSegment to AgentMessage in
one migration, not one scope at a time. First every turn is written to both
tables, a backfill copies history, a parity check compares them, and every
reader switches on the `chat-agent-message` Amplitude flag. Then a second PR
stops writing ChatMessage and drops it. Rollback is the flag until that PR
merges.

- An AgentMessage row reuses its ChatMessage's id: a user row, or the last
  assistant row of a turn. That is how the backfill stays idempotent and why
  feedback and judge telemetry ids need no rewrite.
- Readers rebuild the same `content` and `segments` from parts, so the API,
  the webapp and the model's replayed history do not change. Tool results are
  stored but not yet replayed.
- A citation is an empty text part carrying `providerOptions.goodparty.citation`,
  because the AI SDK has no citation part.
- The flag is global (0% or 100%, one fixed evaluation id, cached 30 seconds),
  not per user: both tables are written, so mixed per-user state buys nothing.

## Context

AgentMessage is the one message table for chat and background agents. Chat
had five scopes on ChatMessage, which never stored tool results.

## Alternatives rejected

- One scope at a time: five migrations of the same store, and ChatMessage
  could only be dropped after the last.
- A soak period: the flag already gives an instant rollback while both tables
  are written.
- Replaying raw tool results now: changes model cost and behaviour, which the
  judge should settle separately.
