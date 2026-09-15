import {
  ContactInteractionDoorKnock,
  ContactInteractionPhoneBanking,
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
  | ContactInteractionPhoneBanking
>

export const SUPPORT_STATUS_UNKNOWN: SupportStatusRollup = 'unknown'

// The single source for the answer → rollup derivation. Both
// SupportStatusService methods (display and filter resolution) compile
// their SQL CASE from this constant so the two can never disagree. The
// `satisfies` clause pins every arm to contracts' SupportStatusRollup — the
// same vocabulary the person-detail response serializes (ENG-10696) — so the
// derivation can't silently drift from what the contract promises.
// `unsure` is `undecided`, not `unknown`: a canvasser who got an answer
// learned something, and collapsing that into the never-contacted bucket
// hid it from every count and filter that reads this rollup.
export const SUPPORT_ANSWER_ROLLUP = {
  [SupportAnswer.supporter]: 'supporter',
  [SupportAnswer.non_supporter]: 'non_supporter',
  [SupportAnswer.unsure]: 'undecided',
} as const satisfies Record<SupportAnswer, SupportStatusRollup>

// How much authority an answer carries over the answers before it: only a firm
// answer may overturn a firm answer.
//
// The reported bug is what recency alone does. A canvasser re-knocks a door
// they already have a "supporter" from, the resident is non-committal this
// time, the canvasser logs "unsure" — and the person flips to `undecided`
// everywhere: the walk list, the map, the per-list counts, the CRM. To the
// candidate that reads as the second pass having overwritten the first, which
// is why it was reported as data loss. Nothing was lost; both rows are still
// there, and this is the projection over them that was wrong.
//
// "I'm not sure today" is weaker evidence than "I support you", whenever it
// was said. A firm answer stands until another firm one replaces it, and two
// equally firm answers are still settled by recency — someone who has changed
// their mind has changed their mind.
//
// One constant, read by all three derivations that colour the same person —
// the SQL ordering in SupportStatusService.derivedStatusSql, and the pick
// `firmestAnswerPerPerson` makes for DoorKnockingStatusService and
// DoorKnockingPackService — for the reason SUPPORT_ANSWER_ROLLUP above is one
// constant: a door that reads one way in Contacts and another way at the door
// tells the candidate nothing except that one of the two is lying.
//
// The three rungs. `none` is a row that carries no answer at all — a
// not-home, a refusal, an inaccessible door — and sitting below every answer
// is the rule that was already here as `(support_answer IS NOT NULL) DESC`,
// now the bottom of this scale rather than a separate clause.
//
// Nothing sits above `firm` on purpose. Ties at a rung are broken by
// recency (callers hand rows over newest-first and compare strictly), which
// is what lets a definite statement be superseded by a later definite
// statement while still not being displaceable by a later shrug. A rung
// above firm would be a ratchet with no release — see the `not_a_voter` case
// in knockStatus.util.ts, which needs exactly the tie, not a higher rung.
//
// **Support status is monotonic until flipped, and that is a decision, not
// an accident.** A voter who moves from `supporter` to `unsure` keeps
// reading `supporter`: `unsure` is soft and never displaces a firm answer,
// however many times or however much later it is recorded. Only the
// opposite firm answer moves them.
//
// This is deliberate and it is worth knowing what it costs, because the
// asymmetry is real: the projection can learn that someone became an
// OPPONENT but not that they became UNDECIDED. Two consequences follow, and
// neither is a bug report anyone will file, because the symptom is a status
// that does NOT change.
//
//   - recommendedListsUniverse.util.ts cuts persuasion universes on
//     supportStatus ['undecided'] and GOTV universes on ['supporter'], so a
//     genuinely cooled supporter stays in GOTV and drops out of persuasion.
//   - A canvasser who logs `unsure` on a known supporter sees the dot stay
//     green. deriveKnockStatus collapses `unsure` to `unknown`, so that
//     answer has no status of its own to show either.
//
// The trade was taken because the reported failure was the other direction
// and it was the one candidates actually noticed: a second pass appeared to
// erase the first pass's answers (QA 9/9-9/10, Jared). Every row is still on
// file and DoorKnockingActivityService.historyByPersonId returns each one's
// own answer, so nothing here loses data — this is only about which row the
// projection reads.
//
// If this is revisited, the two shapes already considered and not taken are
// (a) keep latest-answer-wins and make the append visible as a trail on the
// person sheet — supportPresentation.ts's supportAsOf has most of the
// machinery — and (b) time-bound it, so an `unsure` cannot displace a firm
// answer from the last N days but can displace an older one. Both address
// the original report; both cost more than this does.
export const ANSWER_FIRMNESS = {
  none: 0,
  soft: 1,
  firm: 2,
} as const

export const SUPPORT_ANSWER_FIRMNESS = {
  [SupportAnswer.supporter]: ANSWER_FIRMNESS.firm,
  [SupportAnswer.non_supporter]: ANSWER_FIRMNESS.firm,
  [SupportAnswer.unsure]: ANSWER_FIRMNESS.soft,
} as const satisfies Record<SupportAnswer, number>

// The subset of SupportStatusRollup that SupportStatusService can derive
// from interaction rows. `refused` (ENG-10833) extends the shared rollup
// vocabulary for manual overrides only — nothing derives it from interaction
// history, so it's absent here. Shared by filterDimensions.catalog.ts (the
// assistant's vocabulary, ENG-10837 advertises all five) and
// SupportStatusService.personIdsByEffectiveStatus (which needs to know which
// requested values it can resolve by derivation vs. override-only) so the two
// can't drift apart.
export const DERIVED_SUPPORT_STATUS_VALUES = [
  'supporter',
  'non_supporter',
  'undecided',
  SUPPORT_STATUS_UNKNOWN,
] as const satisfies readonly SupportStatusRollup[]

export type DerivedSupportStatusRollup =
  (typeof DERIVED_SUPPORT_STATUS_VALUES)[number]

export type { SupportStatusRollup }
