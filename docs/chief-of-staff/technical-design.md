# Technical design: Chief of Staff dashboard (Serve)

Status: Draft
Author: Stephen Tanguis
Last updated: 2026-06-09

## Summary

A new "Chief of Staff" dashboard for the Serve portion of the product. It gives
an elected official a single landing surface with three parts: an org-level
support estimate, a list of prioritized task cards, and an AI Chief of Staff they
can chat with. The Chief of Staff is a new, general-purpose, reusable chat
mechanism (distinct from the existing page-specific briefing chat) and is the
first consumer of that mechanism.

Today Serve only has meeting briefings, so the dashboard's task cards are
generated solely from briefings for now. The architecture is built so additional
card sources and a second chat consumer (a Win-side campaign assistant) can be
added without rework.

Reference prototype: https://snuggle-nav-kit.lovable.app/ (high-level; most of its
nav items are future capabilities and out of scope).

## Goals

- A Serve dashboard showing a support estimate, a task-card list, and an entry
  point to the Chief of Staff chat.
- A reusable chat mechanism with a scope abstraction; Chief of Staff is the first
  scope.
- A durable "priorities" model for the official, seeded from their Win campaign
  and managed by the agent.
- A persistent task-card list generated from briefings, that expires past its due
  date and can be dismissed.
- A safe, aggregate-only path to constituent data for the agent (no row-level, no
  party).

## Non-goals (v1)

- Multi-user / staff accounts (data is keyed so this is additive later).
- Card sources other than briefings.
- Per-card "constituents affected" counts.
- Migrating the existing briefing chat onto the new mechanism.
- Row-level constituent data and any querying by political party (explicitly
  disallowed; aggregate-only).
- A "completed" state for priorities (not yet well understood; soft-delete only).
- Briefing keyword search (`search_briefings`) — deferred to v1.1.

## Key concepts

Two concepts that look similar on screen but are different models:

- **Priority** — the official's durable, "invisible" policy/community priorities.
  Keyed on elected office. Seeded from their Win campaign on transition to Serve,
  then created, updated, or soft-deleted by the agent via tools. Not rendered as
  cards in v1; they are context the agent reasons over.
- **Task cards** — persistent rows rendered in the dashboard list. In v1: one
  "review your briefing" card per briefing, plus one card per top-priority
  (featured) agenda item. Created when a briefing is generated, expire past their
  due date (the meeting date), and can be skipped. Skipped and expired cards stay
  viewable in an Archive (This week / Skipped / Missed). They are not priorities.

Other terms:

- **Chief of Staff (CoS) chat** — the dashboard-level assistant. New general chat
  mechanism, owner/org-scoped, no anchoring.
- **Support estimate** — the hero number ("N of M constituents likely support
  you"), read from a data + research table keyed on elected official (mirrors the
  Win number).

## Architecture overview

- **gp-ai-projects** — unchanged. Already generates and QA-vets the briefing JSON
  artifact that feeds the cards.
- **gp-api** — owns the new data models, the general chat backend, priorities,
  dashboard cards, the support-estimate service, and the constituent-data tool.
- **gp-webapp** — renders the dashboard and a reusable chat surface.

Repository layout: these now live in the **omni** monorepo (npm workspaces) under
`omni/packages/` — `gp-api`, `gp-webapp`, `contracts` (`@goodparty_org/contracts`),
plus siblings `election-api` and `people-api`. gp-ai-projects is a separate repo.
Paths in this doc written as `gp-api/...` mean `packages/gp-api/...` from the omni
root, and should be re-verified there (the old top-level clones may be stale).
Package scripts (lint / types / test / verify, migrate) run per package
(`cd packages/gp-api && npm run verify`); Prisma generate runs from the omni root
(`npm run generate:prisma:gp-api`). Contracts is a workspace package, so consumers
resolve it locally.

Scope keys (Serve has `ElectedOffice` 1:1 with `Organization`, slug
`eo-{electedOfficeId}`, 1:1 with a `User` owner):

- Priorities, task cards (and their dismissals), and the support estimate all key
  on `electedOfficeId`.
- CoS conversations key on `ownerUserId` + `organizationSlug` — intentionally
  org-scoped (not `electedOfficeId`), because the chat mechanism is reused by the
  future Win-side campaign assistant, which has no elected office.

Multi-user stays additive.

Resolving the current office is already solved: every new Serve endpoint uses the
existing `@UseElectedOffice()` guard + `@ReqElectedOffice()` param decorator, which
attach `request.electedOffice` from the `X-Organization-Slug` header + authed user
(gp-webapp already sends that header for briefings). No new auth path to build.

```
gp-ai-projects            gp-api                              gp-webapp
--------------            ------                              ---------
briefing pipeline + QA
      | (S3 + SQS)
      v
              MeetingBriefing row + artifact (JSONB cache)
                     |
   handleBriefingCompletion --> DashboardCard rows (created/reconciled)
                     |
   GET /v1/dashboard/cards (active, non-expired, non-dismissed) -> task list
   GET /v1/dashboard/support-estimate (data+research table) ----> support hero
                     |
   General chat (/v1/chats, scope=chief_of_staff) <---> reusable chat surface
     tools: priorities CRUD, web search,
            briefings (list/get), constituent data (aggregate)
                     |
   Priority rows (keyed on elected office; seeded from Win on office creation)
```

## Data model (gp-api)

### Priority

Durable, keyed on elected office, agent-managed. No ordering field (decided
priorities do not need ordering). Soft-delete only — no "completed" concept in v1,
since we don't yet understand what completion means here.

```prisma
model Priority {
  id                       String          @id @default(cuid())
  electedOfficeId          String          @map("elected_office_id")
  electedOffice            ElectedOffice   @relation(fields: [electedOfficeId], references: [id], onDelete: Cascade)

  title                    String
  description              String          @db.Text

  source                   PrioritySource  // win_import | user_stated
  sourceCampaignPositionId String?         @map("source_campaign_position_id")

  targetDate               DateTime?       @map("target_date") @db.Date
  archivedAt               DateTime?       @map("archived_at") // soft delete; null = active

  createdAt                DateTime        @default(now()) @map("created_at")
  updatedAt                DateTime        @updatedAt @map("updated_at")

  @@index([electedOfficeId, archivedAt])
  @@map("priority")
}

enum PrioritySource {
  win_import
  user_stated
}
```

Behavior:

- Agent actions: create, update, soft-delete (set `archivedAt`). No hard delete,
  no "completed" status in v1.
- Default reads and "list my priorities" filter `archivedAt IS NULL`.
- Archived rows remain queryable if we later add a "past priorities" view.

### DashboardCard

Persistent rows, keyed on elected office, created when a briefing is generated.
Office-level dismissals.

```prisma
model DashboardCard {
  id               String            @id @default(cuid())
  electedOfficeId  String            @map("elected_office_id")
  electedOffice    ElectedOffice     @relation(fields: [electedOfficeId], references: [id], onDelete: Cascade)

  type             DashboardCardType // briefing | agenda_item
  title            String
  summary          String            @db.Text
  ctaLabel         String            @map("cta_label")
  ctaHref          String            @map("cta_href")

  dueDate          DateTime          @map("due_date")
  sourceBriefingId String            @map("source_briefing_id")
  sourceItemId     String?           @map("source_item_id")
  dismissedAt      DateTime?         @map("dismissed_at")

  createdAt        DateTime          @default(now()) @map("created_at")
  updatedAt        DateTime          @updatedAt @map("updated_at")

  @@unique([electedOfficeId, type, sourceBriefingId, sourceItemId])
  @@index([electedOfficeId, dismissedAt, dueDate])
  @@map("dashboard_card")
}

enum DashboardCardType {
  briefing
  agenda_item
}
```

Behavior:

- Active set = `dismissedAt IS NULL AND dueDate >= now()`, sorted by `dueDate`.
- Skip ("Skip" in the UI) sets `dismissedAt`. Office-level, so it hides for everyone
  on that office's dashboard.
- **Retention for the Archive**: dismissed and expired cards are NOT hard-deleted —
  the Archive shows them. (Optional pruning of very old rows only.) The Archive's
  buckets are derived from existing fields: `skipped` = `dismissedAt` set; `missed` =
  `dueDate < now() AND dismissedAt IS NULL`; `this_week` = `dueDate` within the
  current week.
- The `@@unique([electedOfficeId, type, sourceBriefingId, sourceItemId])` is the
  stable card identity used for idempotent generation and reconciliation (below).
  `dismissedAt` is preserved across regeneration so a dismissal survives a re-run.

### ChatConversation (generalize existing)

Reuse the existing `ChatConversation` / `ChatMessage` tables and
`ChatStoreService` rather than adding a parallel store. Add a scope discriminator
and org scope, and a title for the history list.

```prisma
// additions to ChatConversation
scope            ChatScope    @default(briefing_annotation)
organizationSlug String?      @map("organization_slug")
title            String?

enum ChatScope {
  briefing_annotation
  chief_of_staff
  campaign_assistant   // future second consumer
}
```

- Backfill existing rows to `briefing_annotation`.
- Briefing chat keeps its current controller/service and its `kind=chat`
  annotation link; it just gains the scope column.
- CoS conversations have no annotation; they are found via
  `(ownerUserId, organizationSlug, scope=chief_of_staff, deletedAt IS NULL)`.
- `title` is auto-generated from the first user message for the history list.

## Backend design (gp-api)

### General chat mechanism

A scope-generic chat service and SSE controller built on the parts worth reusing
from the briefing chat:

- `LlmService.streamChatCompletion` — the Vercel `ai`-SDK tool loop
  (`stopWhen: stepCountIs(maxSteps)`), `buildToolSet` hooks, model routing
  (`resolveChatModel`: `claude-*` to Anthropic, else Together).
- `ChatStreamService` — SSE chunking (`text` / `tool_call` / `tool_result` /
  `done` / `error`), the backpressure `ChunkQueue`, the
  interrupted-before-output sentinel, message persistence.
- `ChatStoreService` — conversation/message CRUD, idempotent append by
  `clientMessageId`, soft delete.

New abstraction:

```ts
interface ChatScopeHandler {
  scope: ChatScope
  resolveConversation(params, userId): Promise<{ conversationId; created }>
  loadContext(conversationId, userId): Promise<ScopeContext>
  buildSystemPrompt(ctx: ScopeContext): string
  buildTools(ctx: ScopeContext): Record<string, LlmStreamTool>
}
```

Handlers are registered by scope. v1 registers `chief_of_staff`. The Win-side
campaign assistant registers later with no controller changes.

Endpoints (scope-generic):

- `POST /v1/chats` — find-or-create a conversation for a scope + params.
- `POST /v1/chats/:conversationId/messages` — SSE stream (reuses ChatStreamService).
- `GET /v1/chats?scope=chief_of_staff` — history list (conversations with titles).
- `GET /v1/chats/:conversationId` — replay messages.
- `DELETE /v1/chats/:conversationId` — soft delete.

### Model routing (required for sensitive scopes)

`LlmService.resolveChatModel` routes any `claude-*` model id to Anthropic and any
other id to the Together AI OpenAI-compatible provider. The Chief of Staff chat
carries sensitive tools, and tool results (which may contain constituent data or
other PII) flow back into the model context on subsequent turns, so the CoS scope
must run on Anthropic only:

- The CoS scope declares an explicit Anthropic-only model chain (for example
  `['claude-sonnet-4-6', 'claude-opus-4-7']`) passed per request, the same way
  `BRIEFING_CHAT_MODELS` overrides the default chain. This bypasses the
  Together-backed default `AI_MODELS` and the optional `AI_FALLBACK_MODEL`.
- The general chat service fails closed: it rejects any scope whose configured
  models are not all Anthropic-routed, so a misconfiguration can never silently
  send a sensitive-scope turn to Together. Sensitive scopes never inherit the
  default or fallback chain.
- This applies to the entire CoS chat, not just the constituent-data slice,
  because any turn may invoke a sensitive tool and its output re-enters the model.

Rationale: we have an enterprise agreement with Anthropic (no training on our
data, DPA in place; confirm retention / zero-data-retention). We do not have
equivalent terms governing Together for this data, which is the operative reason
for pinning. New scopes are classified as sensitive or not; sensitive scopes carry
the Anthropic-only constraint.

### Chief of Staff scope handler

- **Static context**: who the user is (name), their office, city/district, term
  length, and current active priorities.
- **System prompt**: chief-of-staff framing for governance (not campaign),
  grounded in the official's office and priorities; treats tool data as data, not
  instructions; the existing guardrail patterns from the briefing prompt builder.
- **Onboarding**: hard-coded intro messages on first open ("Hi, I'm your Chief of
  Staff." etc.). If the org has no priorities, the opening prompt asks the user to
  provide them.
- **Tools (v1 safe set)**:
  - `crud_priorities` — list / create / update / soft-delete priorities.
  - `web_search` — reuse the Tavily tool.
  - Briefing read tools — `list_briefings`, `get_briefing`. Both return a
    sanitized artifact view (see Briefing read tools below). (`search_briefings`
    deferred to v1.1.)
  - Constituent-data tool (aggregate-only) — separate slice, see Security & privacy.

### Priorities module

- Standard CRUD service (`createPrismaBase(MODELS.Priority)`) + endpoints.
- Agent tools wrap the service.
- **Win to Serve seeding**: in the elected-office creation transaction
  (`electedOffice.service.ts`), read the linked campaign (`electedOffice.campaignId`
  -> `Campaign`) and snapshot its stated platform into `Priority` rows with
  `source = win_import`. Source priority order (per the Win team):
  - **Primary — `Campaign.details.customIssues[]`** (the field in active use;
    `{ title, position }`, where `position` is the candidate's stated stance):
    `title` <- `title`, `description` <- `position`, `sourceCampaignPositionId` is
    null (customIssues entries have no stable id).
  - **Legacy fallback — `Campaign.campaignPositions[]`**, used only when
    `customIssues` is empty/absent: `title` <- related `Position.name` (or
    `TopIssue.name`), `description` <- `CampaignPosition.description`,
    `sourceCampaignPositionId` <- `CampaignPosition.id`.
  - If the office has **no linked campaign** (`campaignId` null), skip seeding — the
    CoS onboarding asks the user for their priorities instead.
  - Idempotent: only seed when the office has no existing `win_import` priorities, so
    re-creation / re-runs can't duplicate.

### Briefing read tools (with artifact sanitization)

The agent reads briefings through two tools, both over the official's own
briefings:

- `list_briefings` — upcoming/recent briefings (date, meeting name, status).
- `get_briefing` — the full briefing for a date.

Deferred to v1.1: `search_briefings` — item-level, app-side tokenized keyword
search over the sanitized fields, returning snippets + anchors
(`briefingItemHref`). The corpus is one official's own briefings (small now, grows
over a term), so no FTS or embeddings are needed; a precomputed `tsvector`
projection is the scale path if history ever gets large. With only a few upcoming
briefings, `list_briefings` + `get_briefing` cover v1, so search waits until there
is history to search.

Sanitization (deterministic, required): the artifact JSON contains internal/QA
scaffolding that must not reach the model — `run_metadata`, `claims` and their
routing (`route_if_unsupported`), `research.raw_context`, internal source
identifiers, and any internal table/column names (`hs_` / `l2_`). The meetings
module already states these "must not leak" and the frontend masks them at the
boundary; the tool does the same. Use a **field allowlist**: project only known
user-facing fields (e.g. `executive_summary`, item `display` summaries, public
`sources`, meeting metadata) and drop everything else. Allowlist over blocklist,
so new internal fields are excluded by default. Reads the `artifact` JSONB cache
(no S3 fetch). When `search_briefings` lands, it searches only allowlisted fields,
so internal text stays non-searchable and non-returnable.

### Dashboard cards module

- **Generation hook**: in `MeetingBriefingsService.handleBriefingCompletion`, after
  `writeBriefingRowFromArtifact` upserts the briefing, read the `artifact` (JSONB,
  no S3 fetch) and upsert cards by their stable identity:
  - one `briefing` card (CTA "Prepare for the meeting", href
    `briefingOverviewHref(date)` -> `/dashboard/briefings/{YYYY-MM-DD}`);
  - one `agenda_item` card per featured item in `executive_summary.items[]`
    (items carry `tier: 'featured' | 'queued' | 'standard'`; CTA href
    `briefingItemHref(date, itemId)` -> `...#briefing-item-{itemId}`);
  - `dueDate = meetingDate` for all.
- **Reconciliation on regeneration**: briefings upsert on
  `(electedOfficeId, meetingDate)`, so a re-run may change featured items. The hook
  upserts current cards by identity and removes cards for that briefing whose item
  is no longer featured. Only content fields are updated on upsert, so `dismissedAt`
  is preserved and a dismissal survives a re-run.
- **Read endpoint**: `GET /v1/dashboard/cards?bucket=active|this_week|skipped|missed`
  (default `active`) returns the cards for that bucket, sorted by date. `active` is
  the main list; the other three back the Archive tabs.
- **Dismiss endpoint**: `PUT /v1/dashboard/cards/:id/dismiss` sets `dismissedAt`
  (the "Skip" action). Cards are retained, not deleted.
- Future non-briefing card sources write their own rows into the same table.

### Support estimate

- Data + research own a table (analogous to the existing Win number), keyed on
  elected official (`electedOfficeId`), holding the support estimate and its
  components.
- `SupportEstimateService` reads that table and returns
  `{ likelySupport, districtSize, percentOfDistrict, trendVsLastMonth }`.
- gp-api does not compute the number; data + research produce and evolve it. An
  interim hard-coded value can back the UI behind the same interface until the
  table lands.
- Dependency: data + research to define and populate the table (see External
  dependencies).

## Frontend design (gp-webapp)

- A new **"Chief of Staff" tab** in the Serve sidebar — a menu item in
  `app/dashboard/shared/DashboardMenu.tsx` (gated by the `serve-access` flag +
  `isElectedOffice`, like "Briefing Assistant"), routing to
  `app/dashboard/chief-of-staff/` inside the existing `DashboardLayout`. It's the
  Serve home (default serve users here); Archive is a `chief-of-staff/archive`
  sub-route. Layout from the prototype:
  - Support hero: label "Likely supporters" + a `(?)` tooltip, the number, and a
    `Progress` bar (no trend/percent line in the current prototype).
  - Two onboarding cards, each with **Skip**: "Meet your virtual chief of staff" and
    "Tell us more about the most important issues you're facing" (the latter opens
    the chat to gather priorities; shown when the office has no priorities).
  - Task-card list (`Card`, `Badge`, `Button`), each with category eyebrow, title,
    date/summary, primary CTA, and **"Skip"**, plus a "See more (N)" expander.
  - An **"Archive"** link → an Archive sub-view with **This week / Skipped / Missed**
    filter pills, each backed by `GET /v1/dashboard/cards?bucket=...`.
  - Persistent footer chat bar + history clock.
- **Reusable chat surface** component (the general chat's frontend half), separate
  from the briefing `AskAiChatBody`, consuming the `/v1/chats` SSE endpoints.
  First-open plays the hard-coded intro messages; tool calls render as status
  lines ("Searching the web", "Reading your priorities", etc.).
- Existing styleguide covers the components needed (`Card`, `Badge`, `Button`,
  `Progress`, `Drawer`/`Sheet`, charts). No new styleguide components anticipated
  for v1.

## Security and privacy: constituent-data tool

A separate, higher-risk slice after the core CoS. It lets the agent answer
aggregate questions about constituents ("how many X in Y") with deterministic
safeguards. It is essentially a more flexible, aggregate-only version of the
existing production `districtInsights` tool, so it inherits that tool's precedent
and safeguards (district scoping, allowlist, sub-100 suppression).

Hard constraints (team decisions):

- **Aggregations only. No row-level results.** Returns counts / sums / averages,
  optionally broken down by a grouping; never a list of people.
- **No political party.** No selecting, filtering, or grouping by party or by any
  modeled partisan-lean column. This is a legal line, not a preference.

Two levers do the enforcement; together they make the design defensible without
requiring full warehouse RLS:

1. **Deterministic query parsing (ours, app-layer).** Extends the existing
   `queryDatabricks.tool.ts` AST checks:
   - SELECT-only, single statement, no invisible chars, no comments, row/time caps
     (existing).
   - **Aggregate-only**: every SELECT-list item must be an aggregate function (from
     an allowlist: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `APPROX_COUNT_DISTINCT`) or
     a column in `GROUP BY`. Reject `SELECT *`, window functions,
     `DISTINCT`-as-enumeration, and subqueries against base views.
   - **Dimension allowlist**: restrict grouping/filtering to a small set of coarse
     dimensions. Party is already blocked by the credential (not granted); this
     mainly limits differencing (can't slice on fine-grained quasi-identifiers) and
     is belt-and-suspenders over the column grants.
2. **A scoped Databricks credential (data team).** The data team provisions a
   dedicated "Serve agent" API key (service principal) with Unity Catalog
   table-level and column-level grants: it can read only approved tables, and PII
   columns (name, address, voter id, phone, email) and party / partisan-lean
   columns are simply not granted. Databricks denies anything outside the grant,
   regardless of the SQL the agent writes. This is lever 2, enforced on the
   credential itself rather than on a view we maintain — there's nothing for us to
   keep correct, and even a parser miss can only ever touch granted, non-PII,
   non-party columns.

Why this combination is sound: we do the active enforcement (aggregate-only and
district filtering) in our own code; the credential is the backstop. Because the
credential cannot read PII or party columns at all, even if our aggregate-only check
ever failed and a single row slipped through, that row would contain no identifiers
and no party — nothing sensitive can be in the result set. So the worst case of an
app-layer bug collapses from "leaked a named constituent" to "returned a
non-sensitive aggregate (or row) that wasn't perfectly scoped," which is tolerable.
Party, being a single column, is fully solved by dropping it from the grant — no
app-layer party logic needed as the primary mechanism.

On the sub-100 floor: it is a backstop, not the headline control. On an
arbitrary-filter interface a per-query floor is defeated by differencing (infer a
small cell as the difference of two large counts), which would reconstruct
row-level facts and defeat the no-row-level rule. The real control against
differencing is the coarse **dimension allowlist** in lever 1 — limit what can be
sliced. Small-cell suppression stays only as a secondary guard.

Identity / Haystaq separation: with no identifier columns granted, there is no way
to attach a name to a modeled score, so the join is structurally impossible. This
falls out of the column grants plus the no-row-level rule.

District scoping: handled in our code (lever 1), since the credential grants
control columns/tables, not which district's rows. Bind the district server-side
from `DistrictResolverService.resolveByUserId` (never from agent input) and inject
the district predicate deterministically. A scoping bug here is bounded by the
credential backstop — the worst case is a non-sensitive aggregate of the wrong
district, never PII or party. (If the data team can also district-scope the granted
tables, that's a bonus layer, not required.)

Model routing: governed by the Model routing requirement above (CoS is an
Anthropic-only scope, fail-closed).

Data team is provisioning the scoped Serve agent credential (lever 2). Remaining
items:

- Give the data team the party column to exclude from the grant (and any modeled
  partisan-lean column, if one exists), alongside PII columns.
- Confirm L2 terms permit sending **aggregate**-derived data to Anthropic (the
  existing `districtInsights` tool already does this, so likely fine).
- `/security-review` + bypass tests before ship. Bypass tests are adversarial test
  cases that actively try to defeat each safeguard and assert it holds, rather than
  testing the happy path — so the design is proven against a motivated query and a
  future refactor can't silently weaken a guardrail (a red test fires instead of a
  privacy hole shipping). Cases to cover: a query selecting a PII column or a
  non-granted table (credential denies); a row-returning query with no aggregation
  (aggregate-only check rejects); a query referencing the party column (not
  granted); a query hard-coding a different district (the server-bound predicate
  wins, agent can't widen); a differencing attempt (coarse dimension allowlist plus
  suppression); and SQL-shape attacks — stacked statements, `UNION` to a system
  table, window functions, comment-hidden tokens (parser rejects). Where possible
  each case asserts both layers: lever 1 rejects the query, and the credential
  backstop means nothing sensitive returns even if it didn't.

## Standing rules (apply to every slice)

- **Contracts**: any shape crossing gp-api ↔ gp-webapp lands in
  `@goodparty_org/contracts` (Zod), in the same PR. Use the `update-contract` skill.
- **Office resolution**: resolve the current `ElectedOffice` via `@UseElectedOffice()`
  + `@ReqElectedOffice()` (needs the `X-Organization-Slug` header). No new auth path.
- **Definition of done**: lint + format + typecheck + tests all green before a slice
  ships. In gp-api that is `npm run verify` (= `npm run lint` [ESLint + prettier
  `--check`] + `npm run types` [tsc] + `npm run test` [vitest]), run from
  `packages/gp-api`; auto-fix with `npm run lint:fix`. Each slice ships with vitest
  tests. gp-webapp slices run that package's equivalent lint / format / typecheck /
  test. Follow gp-api's cursor rules (no `any` / `unknown`, 80-char lines, no
  semicolons, PrismaBase pattern, library enums over literals, date-fns).

## Sequencing

1. **Priorities** — model (keyed on elected office, soft-delete), CRUD, agent
   tools, Win to Serve seeding (primary `customIssues`, legacy `CampaignPosition`
   fallback; idempotent; skip if no linked campaign).
2. **Dashboard cards** — `DashboardCard` model, generation + reconciliation hook on
   briefing completion, read/dismiss endpoints, expiry.
3. **General chat backend** — conversation generalization, scope-generic
   service/controller, CoS handler, safe tools (priorities, web search, briefing
   read tools with sanitization).
4. **Support estimate** — `SupportEstimateService` reading the data + research
   table (interim value until the table lands).
5. **Frontend** — dashboard page, reusable chat surface, history.
6. **Constituent-data tool** (aggregate-only), split:
   - **6a** — app-layer enforcement + bypass tests against a mocked provider;
     buildable now, ships flag-DISABLED.
   - **6b** — wire the scoped Serve agent credential, validate in dev/qa
     (security review + credential-level bypass tests against the real key), then
     enable. Blocked on the data-team credential.

## External dependencies

- Support-estimate table keyed on elected official (analogous to Win number) —
  data + research (Bryan).
- Constituent-data: a scoped "Serve agent" Databricks credential with table- and
  column-level grants (approved tables only; no PII or party columns) — data team
  (Collin, Dan), in progress; we provide the party column (and any partisan-lean
  column) to exclude. District scoping handled in our code.
- Confirm L2 terms permit sending aggregate-derived data to Anthropic (likely fine;
  `districtInsights` precedent).

## Open questions

- Support-estimate table shape and exact key — data + research.
- Party / partisan column list to exclude — data team.
- Monorepo migration workflow: confirm whether to use `migrate:pr` (omni root) vs
  the package's `migrate:dev`. (Source of truth: omni is canonical — confirmed.)

## Appendix: codebase touchpoints (paths under `omni/packages/`)

- Briefing artifact cache (the card source): `MeetingBriefing.artifact` JSONB,
  written by `writeBriefingRowFromArtifact`
  (`gp-api/src/meetings/services/meetingBriefings.service.ts`, upsert at ~L923,
  `artifact` set in create ~L938 and update ~L946; `handleBriefingCompletion` ~L508,
  `onExperimentRunCompleted` ~L491). Read for card generation instead of S3.
  (Line numbers verified against omni canonical 2026-06-10; treat as approximate.)
- Briefing artifact shape: `executive_summary.items[]` (item_id), `items[].tier`.
- Card CTA URLs: `gp-webapp/app/shared/briefings/routes.ts`
  (`briefingOverviewHref`, `briefingItemHref`).
- Current office resolution: `@UseElectedOffice()` / `@ReqElectedOffice()`
  (`gp-api/src/electedOffice/decorators/`, `electedOffice/guards/UseElectedOffice.guard.ts`)
  — attaches `request.electedOffice` from `X-Organization-Slug` + authed user.
- Chat reuse: `gp-api/src/llm/services/llm.service.ts`,
  `gp-api/src/chats/services/chatStream.service.ts`,
  `gp-api/src/chats/services/chatStore.prisma.ts`.
- Org / office / campaign: `Organization` (ownerId, slug `eo-{electedOfficeId}`),
  `ElectedOffice` (userId, organizationSlug, campaignId), `Campaign`
  (campaignPositions[], details.customIssues[], didWin).
- Databricks: `gp-api/src/llm/tools/queryDatabricks.tool.ts`,
  `databricksProvider.ts`, `districtInsights.tool.ts`;
  `gp-api/src/chats/briefing-chats/services/districtResolver.service.ts`.
