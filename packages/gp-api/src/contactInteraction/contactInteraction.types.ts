import {
  ContactInteractionDoorKnock,
  ContactInteractionRobocall,
  ContactInteractionText,
} from '@/generated/prisma'

/**
 * The contact interaction convention (2026-07-14 design review, CRM tech
 * design: https://app.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-98973).
 *
 * Each outreach channel gets its own Prisma model — no generic interaction
 * table, no runtime registry, no abstract base class. What makes them "one
 * kind of thing" is this interface plus the checklist below: every model
 * carries the same core fields, so the activity feed, filter conditions, and
 * derived values can treat channels uniformly while each table keeps its
 * channel-specific columns and idempotency semantics.
 *
 * Adding a new channel:
 *
 * 1. Model named `ContactInteraction<Channel>` in its own
 *    `prisma/schema/contactInteraction<Channel>.prisma` file, mapped to a
 *    `contact_interaction_<channel>` table.
 * 2. Core fields satisfying `ContactInteractionRecord`: `organizationSlug`
 *    (relation to `Organization` with `onDelete: Cascade`), `personId`
 *    (people-api `Voter.id`, a plain `String` — no FK, people-api owns it),
 *    and `occurredAt`.
 * 3. A source FK when the interaction derives from another entity (e.g.
 *    `outreachId` on text/robocall), with `onDelete: Cascade`.
 * 4. An idempotency `@@unique` matching the write path: a per-source-event
 *    key for synced/write-back rows (`[organizationSlug, sourceId]` on door
 *    knock) and/or a per-recipient key for batch materialization
 *    (`[outreachId, personId]` on text/robocall). Nullable key columns are
 *    fine — Postgres treats NULLs as distinct.
 * 5. `@@index([organizationSlug, personId, occurredAt])` — the feed and
 *    person-timeline read path.
 * 6. A service extending `createPrismaBase(MODELS.ContactInteraction<Channel>)`
 *    in `services/`, registered in `ContactInteractionModule`, whose writes
 *    enforce the idempotency key at the DB (upsert on the unique, or
 *    `createMany` with `skipDuplicates`) — never read-then-write.
 * 7. A feed-render variant for the channel, registered with the activity
 *    feed (feature 3 owns that registry; until it lands this is a named
 *    obligation, not code).
 * 8. Filter conditions must be able to resolve the table into person-id sets
 *    with plain SQL (`SELECT person_id FROM contact_interaction_<channel>
 *    WHERE organization_slug = ... AND <channel predicates>`), so keep
 *    filterable values in real columns — never JSON.
 */
export interface ContactInteractionRecord {
  organizationSlug: string
  personId: string
  occurredAt: Date
}

type SatisfiesRecord<T extends ContactInteractionRecord> = T

// The generic constraint is a compile-time proof that every channel model
// satisfies the convention — a new channel missing a core field fails here.
export type ContactInteraction = SatisfiesRecord<
  | ContactInteractionDoorKnock
  | ContactInteractionText
  | ContactInteractionRobocall
>
