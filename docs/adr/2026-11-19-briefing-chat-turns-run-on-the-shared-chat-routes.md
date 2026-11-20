---
title: A briefing chat keeps only its annotation-keyed create and delete; its turns run on /v1/chats
status: active
decided_by: [agent]
date: 2026-11-19
code: []
scope:
  - packages/gp-api/src/chats/briefing-chats/**
  - packages/gp-api/src/chats/general/**
  - packages/gp-webapp/app/shared/briefings/**
  - packages/gp-webapp/app/dashboard/briefings/**
supersedes: []
superseded_by:
---

# A briefing chat keeps only its annotation-keyed create and delete; its turns run on /v1/chats

## Decision

`briefing_annotation` is a normal `ChatScopeHandler` scope for everything a
turn needs. `POST /v1/chats/:conversationId/messages?scope=briefing_annotation`
and `GET /v1/chats/:conversationId?scope=briefing_annotation` serve briefing
chat, exactly as they serve Chief of Staff, Campaign Manager, ordinance flow and
priority flow. `BriefingChatsService.sendMessage`,
`BriefingChatsService.loadConversation` and the
`POST|GET /v1/briefing-chats/:annotationId[/messages]` routes they backed are
gone, along with `SendMessage.schema.ts` and `GetConversation.schema.ts`.

Two routes stay annotation-keyed, because both are about the annotation rather
than about a conversation:

- `POST /v1/briefing-chats` creates the `Annotation(kind=chat)` and its
  `ChatConversation` in one transaction. The generic create path refuses
  `briefing_annotation` (the handler's `resolveConversation` throws), because a
  conversation no annotation points at is one the briefing context cannot load
  — it resolves the context *through* the annotation.
- `DELETE /v1/briefing-chats/:annotationId` soft-deletes the conversation. The
  briefing UI deletes the chat row it renders, and that row is the annotation;
  the shared `DELETE /v1/chats/:conversationId` still works too.

## Context

The scope registry was already the one place a briefing turn's context, prompt
and tools came from: `BriefingAnnotationHandler`. `BriefingChatsService` built
that handler and the module republished it, so the registry and the live send
path shared one instance and could not drift. What remained duplicated was the
turn itself: a second SSE stream loop, a second idempotency check on the user
message id, a second history read, a second usage summation, and a second
`finalizeAssistantText` forward. All of that already existed in
`GeneralChatsService.sendMessage` and the shared `ChatStreamService`, which the
registry route reaches.

Every scope reaches `ChatStreamService` through one call site, and judge
telemetry, judge sweep attribution, page descriptions, attachments and the
supported-model fail-closed check all hang off that call site. A scope with its
own stream loop is a scope those can silently stop applying to. Two things had
already drifted that way on the briefing route: turns reached Grafana Agent
Observability as the generic `chat` agent until an `agentName` was threaded
through the second path, and the stream timeout/sanitisation had to be copied
verbatim.

`POST /v1/briefing-chats` also already wrote `scope` and `organizationSlug` onto
every conversation it created, for exactly this reason, so conversations created
from then on were already reachable through the shared routes. Conversations
created before #2464 (which added the `scope` column) carry it by column default
and a NULL slug, so this change backfills the slug from the annotation's
briefing office (`20261120100000_backfill_briefing_chat_organization_slug`) —
without it, moving turns onto the shared routes would take every existing
briefing thread away from the people who wrote them.

## Alternatives rejected

- **Keep both paths and mirror every change into the briefing one.** That is
  what the parity test existed to police (40 crossed cases asserting the two
  paths registered the same tools and rendered the same prompt), and it had
  already missed the two drifts above. A parity test is a standing bill paid on
  every future change to either path.
- **Move the create onto `/v1/chats` too.** The generic create path writes only
  a conversation; the briefing needs the annotation in the same transaction, and
  the anchor it is created against is the annotation's. Teaching the generic
  path to write a second row for one scope is a bigger special case than a
  four-line controller.
- **Key the whole surface on the conversation, delete included.** The briefing
  UI's delete is on the chat row it renders, which is the annotation, and the
  webapp would otherwise need the annotation → conversation mapping before it
  could delete. `Annotation.chatConversationId` is unique so the mapping is
  reachable, but making the client carry it buys nothing.
