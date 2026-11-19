---
title: Chat's old message tables are dropped in two deploys, not one
status: superseded
decided_by: [swain]
date: 2026-11-19
code: ['#3891']
scope:
  - packages/gp-api/src/chats/**
  - packages/gp-api/prisma/schema/agentMessage.prisma
  - packages/gp-api/prisma/schema/chatMessageFeedback.prisma
supersedes: []
superseded_by: 2026-11-19-the-chat-table-drop-carries-no-guard-test.md
---

# Chat's old message tables are dropped in two deploys, not one

## Decision

`chat_message` and `chat_message_segment` go away, in two steps rather than one:

1. **Make the code independent of them.** Every `ChatMessageFeedback` query
   names its columns with an explicit `select`, none of them the old
   `chat_message_id`; no code uses the `ChatMessage`/`ChatMessageSegment`
   models, and the Chief of Staff's first-conversation count filters on
   `agentMessages` rather than `messages`. A guard test fails the build if
   either comes back.
2. **Drop them.** The schema loses the models and the feedback column, and one
   migration drops the tables and the column. No code changes.

`agent_message_id` stays nullable for that second deploy: #3872's backfill left
a rating null wherever the message it rated had no AgentMessage counterpart,
and a startup migration that refused over one such row would fail the
container's boot and leave a record in `_prisma_migrations` that every later
`migrate deploy` blocks on. NOT NULL is a third, later change, once prod is
known to have none.

## Context

Deploying straight to the drop was the obvious plan and it was wrong, for a
reason that is easy to miss: dropping a column or table does not only break
code that writes it. Prisma names every mapped scalar column in the SELECT it
sends, and in a create's or update's RETURNING, so the deploy that is still
serving traffic during a rollout reads `chat_message_id` on every feedback
query even though nothing uses its value. `mapMineByConversation` sits inside
the `Promise.all` that loads a chat transcript, so on an in-flight rollout a
transcript load fails outright, with zero rows in the table.

ECS keeps old tasks serving while new ones come up (prod holds 100% healthy
through the rollout, with a 120s deregistration delay), so "the code that wrote
it is already gone" is not the same as "no running task touches it". Migrations
run at container boot, ahead of the new tasks taking traffic, so the drop and
the old readers overlap.

The repo cannot express the ordering any other way: `gp-api.yml` fails a
migration that does not match the schema, so a schema-only removal with the
physical drop deferred is drift, and there is no deploy hook that runs
migrations after old tasks drain.

## Alternatives rejected

- **One deploy**: drops the column under tasks that still read it, failing chat
  transcript loads and ratings for the length of the rollout.
- **A schema-only first PR with the drop deferred**: rejected by the repo's own
  migration-drift check, which compares the schema to the migrations on every
  PR.
- **Making `agent_message_id` NOT NULL in the drop**: a `RAISE` on any unkeyed
  row turns a data question into a failed migration record that blocks every
  later deploy until a human resolves it by hand.
