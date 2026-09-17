import { z } from 'zod'
import { SupportStatusRollupSchema } from '../people/Person.schema'

// The channel picked first in the outreach flow. Door knocking's own purpose
// step (its native create flow's "purpose" stage) reads the same
// `OUTREACH_PURPOSE_VALUES` vocabulary as every other channel (Task 9).
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

// The unsaved `VoterFileFilter` shape a recommendation carries. Only the
// fields the recommended-list universes ever populate — not the full
// dozens-of-fields filter schema, which stays gp-api-local since nothing
// else here crosses the wire. `.strict()` is load-bearing: a plain
// `z.object()` silently strips an unrecognized key instead of failing, so
// without it a variant that starts populating a field outside this set
// would drop data with nothing to say so. Strict makes that a loud parse
// failure (500 via ZodResponseInterceptor) instead — still not what you
// want in prod, but recommendedListsFilterSchema.test.ts turns it into a
// red test the moment someone adds such a variant, rather than only in prod.
export const RecommendedListFilterSchema = z
  .object({
    voterStatus: z.array(z.string()).optional(),
    supportStatus: z.array(SupportStatusRollupSchema).optional(),
    independentAffinity: z.boolean().optional(),
    ideologyLiberal: z.boolean().optional(),
    ideologyModerate: z.boolean().optional(),
    ideologyConservative: z.boolean().optional(),
    hasCellPhone: z.boolean().optional(),
    hasAnyPhone: z.boolean().optional(),
    // `county|precinct` pairs (encodePrecinctPair), set only for a
    // door-knocking variant that survived on its precinct-restricted count.
    precincts: z.array(z.string()).optional(),
  })
  .strict()
export type RecommendedListFilter = z.infer<typeof RecommendedListFilterSchema>

export const RecommendedListSchema = z.object({
  variant: RecommendedListVariantSchema,
  filter: RecommendedListFilterSchema,
  count: z.number().int().nonnegative(),
  // `count` over the race's vote goal. Absent — not null — when the vote
  // goal could not be resolved. Deliberately unbounded above: a list can
  // hold several times the votes the race needs, and a `.max(1)` here
  // would 500 the whole response for the districts where that is true.
  voteGoalShare: z.number().nonnegative().optional(),
  // Cents, matching the pricing utils that produce it, and absent for the
  // volunteer-run channels (phone banking, door knocking) rather than zero
  // — a zero reads as "free" where the truth is "not applicable".
  estimatedCostCents: z.number().int().nonnegative().optional(),
  copy: z.object({
    title: z.string(),
    criteriaSummary: z.string(),
  }),
  existingFilterId: z.number().int().nullable(),
})
export type RecommendedList = z.infer<typeof RecommendedListSchema>

export const RecommendedListsResponseSchema = z.array(RecommendedListSchema)
export type RecommendedListsResponse = z.infer<
  typeof RecommendedListsResponseSchema
>
