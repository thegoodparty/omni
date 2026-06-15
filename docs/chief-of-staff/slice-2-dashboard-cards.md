# Slice 2 — Dashboard cards

Self-contained backend slice. No blockers. Start immediately.

## Goal

Persistent task cards for the dashboard, generated when a briefing is created, that
expire past their due date and can be skipped. Skipped and expired cards are
retained for the **Archive** view (This week / Skipped / Missed).

## Package(s)

`packages/gp-api`, `packages/contracts`.

## Data model + migration

New `packages/gp-api/prisma/schema/dashboardCard.prisma`:

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

Add `dashboardCards DashboardCard[]` back-relation to `ElectedOffice`. Migrate.

## Buckets & retention

Skip/dismiss sets `dismissedAt` (office-level). **Do not hard-delete** dismissed or
expired cards — the Archive shows them (optional pruning of very old rows only).
Buckets are derived from existing fields (no schema change):

- `active` (main list) = `dismissedAt IS NULL AND dueDate >= now()`, sorted by
  `dueDate` asc.
- `skipped` = `dismissedAt IS NOT NULL`.
- `missed` = `dueDate < now() AND dismissedAt IS NULL`.
- `this_week` = `dueDate` within the current week (handled/skipped/missed mixed).

## Generation hook (reconciliation)

In `MeetingBriefingsService.handleBriefingCompletion`
(`packages/gp-api/src/meetings/services/meetingBriefings.service.ts`, ~L508), after
`writeBriefingRowFromArtifact` upserts the briefing row, call a new
`DashboardCardsService.syncFromBriefing(briefing)`. Read the `artifact` JSONB (no
S3). Card mapping (verify exact artifact field names against the omni
`BriefingSchema` / `MeetingBriefingArtifact`):

- **briefing card** (one per briefing): `type = briefing`, `sourceItemId = null`,
  `title = artifact.meeting_name`, `summary = artifact.executive_summary.subheadline`
  (fall back to `headline`), `ctaLabel = "Prepare for the meeting"`,
  `ctaHref = briefingOverviewHref(date)` → `/dashboard/briefings/{YYYY-MM-DD}`,
  `dueDate = meetingDate`.
- **agenda_item cards** (one per entry in `artifact.executive_summary.items[]` — that
  array is already the curated top set): `type = agenda_item`,
  `sourceItemId = entry.item_id`, `title = entry.title`, `summary = entry.overview`,
  `ctaLabel = "Learn more"`, `ctaHref = briefingItemHref(date, entry.item_id)` →
  `/dashboard/briefings/{YYYY-MM-DD}#briefing-item-{itemId}`, `dueDate = meetingDate`.

Reconciliation: upsert each card by its stable identity
(`electedOfficeId, type, sourceBriefingId, sourceItemId`); update only content
fields (so `dismissedAt` is preserved); delete cards for this `sourceBriefingId`
whose item is no longer present in the artifact. Do not block the briefing write if
card sync fails (log and continue, mirroring the existing hint-upsert ordering).

The href builders live in gp-webapp (`app/shared/briefings/routes.ts`). Reproduce
the two simple URL formats server-side (they're stable strings); do not import
across the package boundary.

## Endpoints

Module `packages/gp-api/src/dashboardCards/` (or fold into a `dashboard` module),
`@UseElectedOffice()` + `@ReqElectedOffice()`:

- `GET /v1/dashboard/cards?bucket=active|this_week|skipped|missed` (default
  `active`) → the cards for that bucket (filters above), sorted by date. `active`
  is the main list; `this_week|skipped|missed` back the Archive tabs.
- `PUT /v1/dashboard/cards/:id/dismiss` → set `dismissedAt` (the "Skip" action).
  `@HttpCode(NO_CONTENT)`, `await`.

## Contracts

`packages/contracts/src/dashboard/DashboardCard.schema.ts`: the card DTO + the list
response. Rebuild.

## Acceptance criteria

- Briefing completion creates one briefing card + one card per exec-summary item.
- Re-running a briefing reconciles (adds new, removes de-featured) and preserves
  dismissals.
- `GET` default `active` returns only non-dismissed, non-expired cards, sorted by
  due date; `skipped`/`missed`/`this_week` return the right sets.
- Skip (dismiss) moves a card out of `active` into `skipped`; it is retained, not
  deleted.

## Tests (vitest)

- `syncFromBriefing`: creates the right cards from a fixture artifact; second run
  with a changed item list reconciles correctly; preserves `dismissedAt`.
- Read buckets: `active` excludes dismissed+expired; `skipped` = dismissed;
  `missed` = expired-unacted; `this_week` = current-week set. Orders by date.
- Retention: dismissed/expired cards are not deleted (still returned by buckets).
- Dismiss: sets `dismissedAt`, office-scoped.
- Hook: a card-sync failure does not block the briefing row write.

## Standing rules

Contracts in `packages/contracts`; `@UseElectedOffice`/`@ReqElectedOffice`;
`npm run verify` green. Watch: don't change `writeBriefingRowFromArtifact`'s
behavior — only call the new sync after it.
