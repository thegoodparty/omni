import {
  ContactInteractionDoorKnock,
  ContactInteractionRobocall,
  ContactInteractionText,
  SupportAnswer,
} from '@/generated/prisma'
import type { SupportStatusRollup } from '@goodparty_org/contracts'

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
 * 7. A feed-mapping branch for the channel in
 *    `ContactEngagementService.getIndividualActivities` (feature 3,
 *    `src/contactEngagement/`), plus a matching `ConstituentActivity` variant
 *    in `contactEngagement.types.ts`.
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

export const SUPPORT_STATUS_UNKNOWN: SupportStatusRollup = 'unknown'

// The single source for the answer → rollup derivation. Both
// SupportStatusService methods (display and filter resolution) compile
// their SQL CASE from this constant so the two can never disagree. The
// `satisfies` clause pins every arm to contracts' SupportStatusRollup — the
// same vocabulary the person-detail response serializes (ENG-10696) — so the
// derivation can't silently drift from what the contract promises.
export const SUPPORT_ANSWER_ROLLUP = {
  [SupportAnswer.supporter]: 'supporter',
  [SupportAnswer.non_supporter]: 'non_supporter',
  [SupportAnswer.unsure]: SUPPORT_STATUS_UNKNOWN,
} as const satisfies Record<SupportAnswer, SupportStatusRollup>

export type { SupportStatusRollup }
