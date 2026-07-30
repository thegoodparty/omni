import { z } from 'zod'

// Response shape for the recommended-lists endpoint. Every field here is
// candidate-facing: the underlying Haystaq (`hs_*`) model columns that drive the
// numbers stay server-side and are never named in this contract, so the door
// lists a candidate downloads can't leak the proprietary column identifiers.

export const RECOMMENDED_LIST_ELECTION_CODE_VALUES = [
  'General',
  'ConsolidatedGeneral',
  'LocalOrMunicipal',
] as const
export const RecommendedListElectionCodeSchema = z.enum(
  RECOMMENDED_LIST_ELECTION_CODE_VALUES,
)
export type RecommendedListElectionCode = z.infer<
  typeof RecommendedListElectionCodeSchema
>

export const RECOMMENDED_LIST_SUB_GEO_LABEL_VALUES = [
  'counties',
  'municipalities',
  'precincts',
  'wards',
] as const
export const RecommendedListSubGeoLabelSchema = z.enum(
  RECOMMENDED_LIST_SUB_GEO_LABEL_VALUES,
)
export type RecommendedListSubGeoLabel = z.infer<
  typeof RecommendedListSubGeoLabelSchema
>

export const RECOMMENDED_LIST_PARTISAN_SHAPE_VALUES = ['NP1', 'P4'] as const
export const RecommendedListPartisanShapeSchema = z.enum(
  RECOMMENDED_LIST_PARTISAN_SHAPE_VALUES,
)
export type RecommendedListPartisanShape = z.infer<
  typeof RecommendedListPartisanShapeSchema
>

export const RecommendedListTurfSchema = z.object({
  area: z.string(),
  voterCount: z.number().int().nonnegative(),
})
export type RecommendedListTurf = z.infer<typeof RecommendedListTurfSchema>

export const RecommendedListMetaSchema = z.object({
  officeName: z.string().nullable(),
  state: z.string(),
  districtType: z.string(),
  districtName: z.string().nullable(),
  districtLabel: z.string(),
  registeredVoters: z.number().int().nullable(),
  projectedTurnout: z.number().int().nullable(),
  votesNeeded: z.number().int().nullable(),
  electionCode: RecommendedListElectionCodeSchema,
  electionDate: z.string().nullable(),
  subGeoLabel: RecommendedListSubGeoLabelSchema,
  doorRatio: z.number(),
})
export type RecommendedListMeta = z.infer<typeof RecommendedListMetaSchema>

export const RecommendedListAnchorSchema = z.object({
  votescoreThreshold: z.number().int().nullable(),
  voterCount: z.number().int().nullable(),
  doorCount: z.number().int().nullable(),
  estimatedHours: z.number().nullable(),
  turfs: z.array(RecommendedListTurfSchema),
})
export type RecommendedListAnchor = z.infer<typeof RecommendedListAnchorSchema>

export const RecommendedListIssueCardSchema = z.object({
  phrase: z.string(),
  opponentName: z.string().nullable(),
  threatTier: z.string().nullable(),
  activeVoters: z.number().int(),
  supporters: z.number().int(),
  opponents: z.number().int(),
  persuadable: z.number().int(),
  supportersPlausible: z.number().int(),
})
export type RecommendedListIssueCard = z.infer<
  typeof RecommendedListIssueCardSchema
>

export const RecommendedListPartisanSignalsSchema = z.object({
  partySwitchers: z.number().int(),
  ticketSplitters: z.number().int(),
  crossoverPrimary: z.number().int(),
  doubleDislike: z.number().int(),
  modeledIndependents: z.number().int(),
  registrationAddOn: z.number().int().nullable(),
})
export type RecommendedListPartisanSignals = z.infer<
  typeof RecommendedListPartisanSignalsSchema
>

export const RecommendedListPartisanSchema = z.object({
  shape: RecommendedListPartisanShapeSchema,
  isPartisanRace: z.boolean(),
  hasDemOpponent: z.boolean(),
  hasGopOpponent: z.boolean(),
  targetParties: z.string().nullable(),
  cardSubtitle: z.string(),
  signals: RecommendedListPartisanSignalsSchema.describe(
    'Every signal count here is within the plausible-turnout ' +
      'electorate: each is band-intersected (∩ the plausible-turnout ' +
      'electorate, VOTESCORE >= s*).',
  ),
  districtTotal: z.number().int(),
  districtWideUnionCount: z
    .number()
    .int()
    .describe(
      'Union of the independence signals across the whole district, ' +
        'NOT intersected with the plausible-turnout electorate — may ' +
        'exceed the sum of the banded signals below',
    ),
  plausibleElectorateCount: z.number().int(),
  listCount: z
    .number()
    .int()
    .describe(
      'the banded union: signals union ∩ plausible-turnout ' +
        'electorate — the recommended door list size',
    ),
  turfs: z.array(RecommendedListTurfSchema),
})
export type RecommendedListPartisan = z.infer<
  typeof RecommendedListPartisanSchema
>

// A gotv envelope is emitted only when turnout drop-off applies to the office,
// so exponentA is always present here (absence of the envelope, not a null,
// means "not applicable").
export const RecommendedListGotvSchema = z.object({
  dropoffX: z.number().int(),
  exponentA: z.number(),
})
export type RecommendedListGotv = z.infer<typeof RecommendedListGotvSchema>

// Outreach channels a list can be worked through. Value set (and casing) tracks
// the product's outreach vocabulary (https://snuggle-nav-kit.lovable.app/outreach),
// with two deliberate deviations: `phone` is kept (not `phoneBanking`) and
// `directMail` is retained.
export const RECOMMENDED_LIST_OUTREACH_TYPE_VALUES = [
  'socialMedia',
  'sms',
  'email',
  'robocall',
  'phone',
  'doorKnocking',
  'poll',
  'directMail',
] as const
export const RecommendedListOutreachTypeSchema = z.enum(
  RECOMMENDED_LIST_OUTREACH_TYPE_VALUES,
)
export type RecommendedListOutreachType = z.infer<
  typeof RecommendedListOutreachTypeSchema
>

export const RECOMMENDED_LIST_PHASE_VALUES = [
  'earlyCampaign',
  'midCampaign',
  'gotvPhase',
] as const
export const RecommendedListPhaseSchema = z.enum(RECOMMENDED_LIST_PHASE_VALUES)
export type RecommendedListPhase = z.infer<typeof RecommendedListPhaseSchema>

// Product-facing outreach goal a list serves. This is a coarser, candidate-facing
// categorization than `kind` (the machine discriminant that types `details`):
// multiple kinds can share a goal (both persuasion kinds -> 'persuasion'), and
// some goals have no list yet (eventInvite / earlyVote / custom). Value set (and
// casing) tracks the product's outreach vocabulary:
// https://snuggle-nav-kit.lovable.app/outreach
export const RECOMMENDED_LIST_GOAL_VALUES = [
  'introduction',
  'persuasion',
  'eventInvite',
  'earlyVote',
  'gotv',
  'custom',
] as const
export const RecommendedListGoalSchema = z.enum(RECOMMENDED_LIST_GOAL_VALUES)
export type RecommendedListGoal = z.infer<typeof RecommendedListGoalSchema>

// Every recommended list is wrapped in a metadata envelope: the product-facing
// `goal` (a coarse, candidate-facing category — several lists can share one, e.g.
// both persuasion lists are goal 'persuasion'), the unique `variant` that
// discriminates `details` (the specific list recipe), display order (priority),
// and the outreach channels / campaign phases it applies to. This is the contract
// seed of a config-driven model — a new list variant adds a member here plus its
// details schema, without changing the top-level response shape.
const RecommendedListEnvelopeBaseSchema = z.object({
  name: z.string(),
  goal: RecommendedListGoalSchema,
  priority: z.number().int(),
  allowedOutreachTypes: z.array(RecommendedListOutreachTypeSchema).min(1),
  allowedPhases: z.array(RecommendedListPhaseSchema).min(1),
})

export const RecommendedListEnvelopeSchema = z.discriminatedUnion('variant', [
  RecommendedListEnvelopeBaseSchema.extend({
    variant: z.literal('voterSupportId'),
    details: RecommendedListAnchorSchema,
  }),
  RecommendedListEnvelopeBaseSchema.extend({
    variant: z.literal('persuasionIssueAligned'),
    details: RecommendedListIssueCardSchema,
  }),
  RecommendedListEnvelopeBaseSchema.extend({
    variant: z.literal('persuasionPartisanAligned'),
    details: RecommendedListPartisanSchema,
  }),
  RecommendedListEnvelopeBaseSchema.extend({
    variant: z.literal('gotv'),
    details: RecommendedListGotvSchema,
  }),
])
export type RecommendedListEnvelope = z.infer<
  typeof RecommendedListEnvelopeSchema
>

export const RecommendedListsSchema = z.object({
  meta: RecommendedListMetaSchema,
  lists: z.array(RecommendedListEnvelopeSchema),
})
export type RecommendedLists = z.infer<typeof RecommendedListsSchema>

export const RecommendedListsResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('failed') }),
  z.object({ status: z.literal('unavailable') }),
  z.object({
    status: z.literal('ready'),
    computedAt: z.string(),
    lists: RecommendedListsSchema,
  }),
])
export type RecommendedListsResponse = z.infer<
  typeof RecommendedListsResponseSchema
>
