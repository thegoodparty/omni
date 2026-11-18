---
title: A chat user turn's id is the client's, and it is the row's primary key
status: active
decided_by: [swain]
date: 2026-11-18
code: ['#3872']
scope:
  - packages/gp-api/src/chats/**
  - packages/gp-api/prisma/schema/agentMessage.prisma
  - packages/gp-api/prisma/schema/chatMessageFeedback.prisma
supersedes: []
superseded_by:
---

# A chat user turn's id is the client's, and it is the row's primary key

## Decision

The id the client sends with a chat message becomes the id of the `user`
`AgentMessage` row for that turn. It is not a dedupe key stored beside a
server-generated id; it *is* the id.

- A send with a new id inserts the user row and runs the turn.
- A send whose id is already this conversation's own user row is a retry: no
  turn runs, and the stored reply is replayed if there is one.
- A send whose id is held by anything else — another conversation, another
  owner, a background run, or a non-user row — is a 409 whose body says
  nothing about the row that holds it.
- A canned reply's id is `UUIDv5(namespace, userMessageId)`, so a retry
  derives the same id and the primary key dedupes it. The old
  `${clientMessageId}:assistant` string key is gone.
- Assistant and tool rows keep server-generated `uuid(7)` ids.
- `id` is validated as a UUID, strictly. The old `clientMessageId` name is
  still accepted as an alias for one release so a tab loaded before the rename
  keeps deduping; it maps to the same id.

## Context

Chat was moving off `ChatMessage`, which carried a `client_message_id` column
with a partial unique index — the only store of the retry key. Dropping the
table would have dropped retry idempotency with it: a double-click or a
network retry would run the model twice and append a duplicate turn. The
canned-reply path additionally *required* that key and derived
`${clientMessageId}:assistant` from it to keep its own retries from appending
a second assistant row.

The obvious repair was a nullable `client_message_id` plus a partial unique
index on `agent_message`. That duplicates, in a second column, a value that
for a user row is an identity in its own right: the client already mints one
per logical send and reuses it on retry. Making it the primary key expresses
the same rule with one fewer column and one fewer index, and lets the database
enforce it on every insert instead of only where application code remembers to
check.

## Alternatives rejected

- A nullable `client_message_id` column with a partial unique index: stores
  the same value twice on every user row and needs a second lookup before the
  write to tell a retry from a fresh send.
- Dropping retry idempotency along with the table: a user-visible regression
  on every chat send, and it breaks the canned-reply path, which cannot derive
  its own key without one.
- A server-assigned id with a client-supplied idempotency token: two ids for
  one message, and every reader has to know which one an `assistantMessageId`
  refers to.
