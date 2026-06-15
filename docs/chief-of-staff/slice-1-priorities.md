# Slice 1 — Priorities

Self-contained backend slice. No blockers. Start immediately.

## Goal

A durable, agent-managed "priorities" model for an elected official, seeded from
their Win campaign on office creation, with CRUD endpoints and agent tools.

## Package(s)

`packages/gp-api`, `packages/contracts`.

## Data model + migration

New `packages/gp-api/prisma/schema/priority.prisma`:

```prisma
model Priority {
  id                       String          @id @default(cuid())
  electedOfficeId          String          @map("elected_office_id")
  electedOffice            ElectedOffice   @relation(fields: [electedOfficeId], references: [id], onDelete: Cascade)

  title                    String
  description              String          @db.Text

  source                   PrioritySource  // win_import | user_stated
  sourceCampaignPositionId Int?            @map("source_campaign_position_id")

  targetDate               DateTime?       @map("target_date") @db.Date
  archivedAt               DateTime?       @map("archived_at")

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

Add the back-relation `priorities Priority[]` to `ElectedOffice`. Run
`npm run migrate:dev` (confirm monorepo migration workflow first — see README).
Note `sourceCampaignPositionId` is `Int?` because `CampaignPosition.id` is `Int`.

## Service (PrismaBase)

`packages/gp-api/src/priorities/services/priorities.service.ts` extends
`createPrismaBase(MODELS.Priority)`. Methods:

- `listActive(electedOfficeId)` → `archivedAt IS NULL`, ordered by `createdAt`.
- `create(electedOfficeId, { title, description, targetDate? }, source)`.
- `update(id, electedOfficeId, patch)` — scope-checked to the office.
- `archive(id, electedOfficeId)` → set `archivedAt = now()`.
- `seedFromWin(electedOfficeId, tx?)` — see below.

## Win → Serve seeding

Called in the elected-office creation transaction
(`packages/gp-api/src/electedOffice/services/electedOffice.service.ts`). Read the
linked campaign via `electedOffice.campaignId` → `Campaign`.

- If `campaignId` is null → **skip** (CoS onboarding will ask the user).
- **Idempotent**: skip if the office already has any `win_import` priority.
- **Primary source — `Campaign.details.customIssues[]`** (active; type
  `Record<'title' | 'position', string>[]`): per entry, `title ← title`,
  `description ← position` (the candidate's stance), `sourceCampaignPositionId = null`,
  `source = win_import`.
- **Legacy fallback — `Campaign.campaignPositions[]`** (only when `customIssues` is
  empty/absent): per row, `title ← position.name` (or `topIssue.name` if present),
  `description ← campaignPosition.description ?? ''`,
  `sourceCampaignPositionId ← campaignPosition.id`, `source = win_import`.

Verify the `customIssues` type and `campaignPosition` relations against the omni
schema (`prisma/schema/campaign.jsonTypes.d.ts`, `campaignPosition.prisma`,
`position.prisma`, `topIssue.prisma`).

## Endpoints

Module `packages/gp-api/src/priorities/`, controller decorated with
`@UseElectedOffice()`, reading `@ReqElectedOffice()`:

- `GET /v1/priorities` → active priorities for the office.
- `POST /v1/priorities` → create (`source = user_stated`).
- `PUT /v1/priorities/:id` → update.
- `DELETE /v1/priorities/:id` → soft-delete (archive). `@HttpCode(NO_CONTENT)`,
  `await` the service call.

Use `@ResponseSchema(...)` + the global Zod interceptor.

## Agent tools

`packages/gp-api/src/llm/tools/priorities.tool.ts` exporting builders that wrap the
service, following the existing `LlmStreamTool` shape (description, Zod
`inputSchema`, `execute`). Cover list / create / update / soft-delete. Consumed by
slice 3's CoS scope handler (slice 3 imports these). Exposed name: `crud_priorities`
(either one tool with an `action` arg or a small set — match how other tools in
`src/llm/tools/` are shaped).

## Contracts

`packages/contracts/src/priorities/Priority.schema.ts` (own file): the `Priority`
DTO and the create/update input schemas. Rebuild contracts.

## Acceptance criteria

- Migration applies; `Priority` rows are office-scoped.
- Office creation with a linked campaign seeds priorities from `customIssues` (or
  legacy `campaignPositions`); no campaign → no seed; re-running doesn't duplicate.
- CRUD endpoints enforce office scope; delete soft-archives; list hides archived.
- Agent tools list/create/update/archive correctly.

## Tests (vitest)

- `seedFromWin`: customIssues path, legacy fallback path, no-campaign skip,
  idempotency (second call no-ops).
- Service: archive hides from `listActive`; update is office-scoped (can't touch
  another office's row).
- Controller: `@UseElectedOffice` wiring (happy + missing header → 404).
- Tools: each action maps to the service.

## Standing rules

Contracts in `packages/contracts` (same PR); `@UseElectedOffice`/`@ReqElectedOffice`
for office; `npm run verify` green in `packages/gp-api`.
