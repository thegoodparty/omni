# Slice 3 — General chat backend + Chief of Staff scope

Largest slice. Start in parallel; soft dependency on slice 1 for the
`crud_priorities` tool.

> ⚠️ **Do not regress the briefing chat.** This slice touches the shared
> `ChatConversation` / `ChatStoreService` that the existing briefing chat depends
> on. Build the general chat as a **new module** reusing the low-level services;
> leave the briefing-chats controller/service untouched. The `scope` column must be
> backward-compatible (default + backfill). The existing briefing-chat tests must
> still pass.

## Goal

A reusable, scope-generic chat mechanism (the Chief of Staff is its first scope),
reusing `LlmService`, `ChatStreamService`, and `ChatStoreService`.

## Package(s)

`packages/gp-api`, `packages/contracts`.

## Data model + migration

Alter `packages/gp-api/prisma/schema/chatConversation.prisma`:

```prisma
scope            ChatScope    @default(briefing_annotation)
organizationSlug String?      @map("organization_slug")
title            String?

enum ChatScope {
  briefing_annotation
  chief_of_staff
  campaign_assistant   // future
}
```

Migration must **backfill** existing rows to `briefing_annotation` (the default
covers new + existing; verify the data migration). CoS conversations are found via
`(ownerUserId, organizationSlug, scope = chief_of_staff, deletedAt IS NULL)`.

## ChatScope abstraction

`ChatScopeHandler` interface + a registry keyed by `ChatScope`:

```ts
interface ChatScopeHandler {
  scope: ChatScope
  isSensitive: boolean // CoS = true (Anthropic-only, see Model routing)
  resolveConversation(params, userId): Promise<{ conversationId; created }>
  loadContext(conversationId, userId): Promise<ScopeContext>
  buildSystemPrompt(ctx): string
  buildTools(ctx): Record<string, LlmStreamTool>
}
```

v1 registers one handler: `chief_of_staff`.

## Scope-generic controller/service

New module `packages/gp-api/src/chats/general/` (name TBD), reusing the existing
`ChatStreamService` (SSE chunks, ChunkQueue, persistence) and `ChatStoreService`:

- `POST /v1/chats` — find-or-create conversation for `{ scope, ...params }`.
- `POST /v1/chats/:conversationId/messages` — SSE stream (reuse `ChatStreamService`).
- `GET /v1/chats?scope=chief_of_staff` — history list (conversations + titles).
- `GET /v1/chats/:conversationId` — replay messages.
- `DELETE /v1/chats/:conversationId` — soft delete.

`title` auto-generated from the first user message (truncate, simplest).

## Model routing (required — sensitive scope)

`LlmService.resolveChatModel` routes `claude-*` → Anthropic, else Together. CoS is a
**sensitive** scope and must run Anthropic-only:

- Pass an explicit claude-only chain per request (e.g.
  `['claude-sonnet-4-6', 'claude-opus-4-7']`), like the existing
  `BRIEFING_CHAT_MODELS`, bypassing `AI_MODELS` / `AI_FALLBACK_MODEL`.
- **Fail closed**: the service rejects a sensitive scope whose configured models
  aren't all claude-routed. (Tool outputs can carry sensitive data into the next
  turn's context; the Anthropic enterprise agreement covers Anthropic, not Together.)

## Chief of Staff scope handler

- **Static context**: user name, office, city/district, term length, current active
  priorities.
- **System prompt**: chief-of-staff framing for governance (not campaign), grounded
  in office + priorities; tool data is data not instructions; reuse the guardrail
  patterns from the briefing prompt builder.
- **Onboarding**: first open (no prior CoS conversation for the office) plays the
  hard-coded intro messages; if no priorities, the opening prompt asks the user to
  provide them. (Decide: persist intro as assistant messages vs client-only — keep
  simple; client-only is fine if it's purely presentational.)
- **Tools (v1)**:
  - `crud_priorities` — from slice 1 (`src/llm/tools/priorities.tool.ts`). Soft dep;
    wire once slice 1's service exists or against its interface.
  - `web_search` — reuse the existing Tavily tool.
  - Briefing read tools — `list_briefings`, `get_briefing`, returning a **sanitized**
    artifact (field allowlist; strip `run_metadata`, `claims`/routing,
    `research.raw_context`, internal source ids, `hs_`/`l2_`). `search_briefings` is
    deferred to v1.1.

## Contracts

`packages/contracts/src/chats/` (own files): the chat message DTO, the conversation
/ history DTO, and the SSE `ChatStreamEvent` union (reuse/lift the briefing chat's
event shapes where identical). Rebuild.

## Acceptance criteria

- Existing briefing chat unchanged and its tests pass.
- `scope` column added + backfilled; CoS conversations resolve/find-or-create.
- SSE streaming works through the reused `ChatStreamService`.
- CoS handler: static context + tools + onboarding; Anthropic-only enforced
  (fail-closed on a non-claude sensitive-scope chain).
- History list returns titled conversations; replay + soft-delete work.

## Tests (vitest)

- Migration/back-compat: a briefing-annotation conversation still behaves as before.
- Scope routing: a request for `chief_of_staff` uses the CoS handler's prompt+tools.
- Fail-closed: a sensitive scope configured with a non-claude model is rejected.
- Sanitization: `get_briefing` output excludes internal fields (assert
  `run_metadata`/`claims`/`hs_`/`l2_` absent).
- Find-or-create + history list + soft delete.

## Standing rules

Contracts in `packages/contracts`; office via `@UseElectedOffice` where applicable;
`npm run verify` green. The bold warning at top is the #1 watch item.
