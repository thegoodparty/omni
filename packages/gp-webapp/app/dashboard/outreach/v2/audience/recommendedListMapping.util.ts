import {
  RECOMMENDED_LIST_VARIANT_INTENT,
  type OutreachPurpose,
  type RecommendedListFilter,
  type RecommendedListIntent,
  type RecommendedListVariant,
} from '@goodparty_org/contracts'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'

// The recommended-lists intent a purpose slug maps onto
// (docs/features/recommended-lists.md). Every outreach channel has shared one
// purpose vocabulary since Task 0 — SmsPurpose/RobocallPurpose/
// PhoneBankingPurpose/DoorKnockingPurpose are literal re-exports of the same
// OutreachPurpose array, not per-channel variants, so this is the one map
// every flow calls rather than four copies that must stay byte-identical by
// hand. "custom" gets no recommendation; Serve's own non-electoral vocabulary
// shares some of these slug strings for an unrelated meaning and must be
// excluded by the caller (checking its own Win/Serve surface) before ever
// reaching this.
const PURPOSE_TO_RECOMMENDED_INTENT: Record<
  Exclude<OutreachPurpose, 'custom'>,
  RecommendedListIntent
> = {
  introduce_myself: 'introduce',
  persuade_voters: 'persuade',
  event_invite: 'event',
  early_voting: 'earlyVote',
  election_day_turnout: 'electionDay',
}

export const intentForOutreachPurpose = (
  purpose: OutreachPurpose,
): RecommendedListIntent | null =>
  purpose === 'custom' ? null : PURPOSE_TO_RECOMMENDED_INTENT[purpose]

// The inverse, for a recommendation carried in from the voter data page:
// its card was picked before any purpose, and the card's intent IS the
// answer to "What do you want to do?", so the flow opens past that step.
// Derived from the forward map rather than written twice, so the two cannot
// disagree about which slug an intent is.
const RECOMMENDED_INTENT_TO_PURPOSE = Object.fromEntries(
  Object.entries(PURPOSE_TO_RECOMMENDED_INTENT).map(([purpose, intent]) => [
    intent,
    purpose,
  ]),
) as Record<RecommendedListIntent, Exclude<OutreachPurpose, 'custom'>>

export const purposeForRecommendedVariant = (
  variant: RecommendedListVariant,
): Exclude<OutreachPurpose, 'custom'> =>
  RECOMMENDED_INTENT_TO_PURPOSE[RECOMMENDED_LIST_VARIANT_INTENT[variant]]

// Voter_Status band values (docs/features/recommended-lists.md) as they
// arrive on a RecommendedListFilter, mapped onto the builder's voter-file
// boolean keys (filters.config.ts).
const VOTER_STATUS_TO_BUILDER_KEY: Record<string, string> = {
  Super: 'audienceSuperVoters',
  Likely: 'audienceLikelyVoters',
  Unreliable: 'audienceUnreliableVoters',
  Unlikely: 'audienceUnlikelyVoters',
  Unknown: 'audienceUnknown',
}

// The one place a recommendation's filter becomes a builder filter — shared
// by every flow that offers recommendations (SMS/robocall/phone banking via
// useOutreachAudience, door knocking via CreateListFlow), since a two-copy
// version of this map is exactly the drift Task 8's review caught in the
// purpose->intent map above.
export const builderFiltersFromRecommendation = (
  filter: RecommendedListFilter,
): VoterFileFilters => {
  const result: VoterFileFilters = {}
  for (const status of filter.voterStatus ?? []) {
    const key = VOTER_STATUS_TO_BUILDER_KEY[status]
    if (key) result[key] = true
  }
  if (filter.independentAffinity) result.independentAffinity = true
  if (filter.ideologyLiberal) result.ideologyLiberal = true
  if (filter.ideologyModerate) result.ideologyModerate = true
  if (filter.ideologyConservative) result.ideologyConservative = true
  if (filter.hasCellPhone) result.hasCellPhone = true
  if (filter.hasAnyPhone) result.hasAnyPhone = true
  return result
}
