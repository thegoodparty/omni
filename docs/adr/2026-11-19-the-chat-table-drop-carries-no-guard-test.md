---
title: The chat table drop carries no guard test
status: active
decided_by: [agent]
date: 2026-11-19
code: ['#3893']
scope:
  - packages/gp-api/src/chats/**
  - packages/gp-api/prisma/schema/**
supersedes: ['2026-11-19-chat-message-tables-are-dropped.md']
superseded_by:
---

# The chat table drop carries no guard test

## Decision

Dropping `chat_message` and `chat_message_segment` deletes the source-scanning
guard test that #3891 added with them, and leaves nothing in its place. The
two-deploy ordering the guard protected is spent: all of its code landed in
#3891, and #3893 removes the models from the schema.

The regenerated Prisma client has no `chatMessage` or `chatMessageSegment`
delegate, so a leftover `.chatMessage` or `MODELS.ChatMessage` no longer
compiles. `tsc` already runs in CI, which makes the guard a second, weaker
copy of a check the build does at full strength: it matched source text rather
than resolving anything, so it missed an indirect query through a variable and
could fire on an unrelated `messages: {` object literal.

## Context

This record supersedes `2026-11-19-chat-message-tables-are-dropped.md`. What
that record decided about the ordering still holds and is not restated here:
the two deploys, and why a column drop under tasks that still select it fails
chat transcript loads for a rollout. What changes is its claim that "a guard
test fails the build if either comes back" — that test no longer exists.

`packages/gp-api/docs/writing-tests.md` § "Dead and one-shot code" is the rule
that forces the deletion: a test earns its place by catching a future bug in
code that still runs, and a test that only restates what a compiler or a
deletion already guarantees cannot. It names "a test that a deleted route
still 404s" as the same shape.

## Alternatives rejected

- **Invert the assertion, keeping the file as a ratchet.** A ratchet over a
  deletion has nothing left to hold: the schema is the whole statement, and
  re-adding the models is a decision no regex prevents.
- **Keep the `messages: {` scan.** It only inspects files that mention
  `chatConversation.` or `MODELS.ChatConversation`, so it misses a query
  reached through a variable and can match an unrelated object literal — a
  false pass and a false failure for one regex.
