import { z } from 'zod'

// The channel picked first in the outreach flow. Door knocking has no
// purpose step of its own yet (Task 9 adds one), but reads the same
// vocabulary once it does.
export const RECOMMENDED_LIST_CHANNEL_VALUES = [
  'sms',
  'robocall',
  'phoneBanking',
  'doorKnocking',
] as const
export const RecommendedListChannelSchema = z.enum(
  RECOMMENDED_LIST_CHANNEL_VALUES,
)
export type RecommendedListChannel = z.infer<
  typeof RecommendedListChannelSchema
>

// The five outreach intents a shared OutreachPurpose slug maps onto.
// `custom` and social's `issue_update` map to no intent and get no
// recommendation.
export const RECOMMENDED_LIST_INTENT_VALUES = [
  'introduce',
  'persuade',
  'event',
  'earlyVote',
  'electionDay',
] as const
export const RecommendedListIntentSchema = z.enum(
  RECOMMENDED_LIST_INTENT_VALUES,
)
export type RecommendedListIntent = z.infer<typeof RecommendedListIntentSchema>

// The 13 recommended universes, grouped by intent in display order.
export const RECOMMENDED_LIST_VARIANT_VALUES = [
  'introNeverIded',
  'persuadeAffinity',
  'persuadeIdeology',
  'persuadeUndecided',
  'eventSupporters',
  'eventAffinity',
  'eventIdeology',
  'earlyVoteSupporters',
  'earlyVoteAffinity',
  'earlyVoteIdeology',
  'electionDaySupporters',
  'electionDayAffinity',
  'electionDayIdeology',
] as const
export const RecommendedListVariantSchema = z.enum(
  RECOMMENDED_LIST_VARIANT_VALUES,
)
export type RecommendedListVariant = z.infer<
  typeof RecommendedListVariantSchema
>
