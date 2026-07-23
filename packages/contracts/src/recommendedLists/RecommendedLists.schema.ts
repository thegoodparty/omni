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
  signals: RecommendedListPartisanSignalsSchema,
  districtTotal: z.number().int(),
  unionCount: z.number().int(),
  plausibleElectorateCount: z.number().int(),
  listCount: z.number().int(),
  turfs: z.array(RecommendedListTurfSchema),
})
export type RecommendedListPartisan = z.infer<
  typeof RecommendedListPartisanSchema
>

export const RecommendedListGotvSchema = z.object({
  applies: z.boolean(),
  dropoffX: z.number().int(),
  exponentA: z.number().nullable(),
})
export type RecommendedListGotv = z.infer<typeof RecommendedListGotvSchema>

export const RecommendedListsSchema = z.object({
  meta: RecommendedListMetaSchema,
  anchor: RecommendedListAnchorSchema,
  issueCards: z.array(RecommendedListIssueCardSchema),
  partisan: RecommendedListPartisanSchema.nullable(),
  gotv: RecommendedListGotvSchema,
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
