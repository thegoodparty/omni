import { z } from 'zod'

export const RACE_OPPONENT_SOURCE_TYPE_VALUES = [
  'ballotpedia',
  'opponent_website',
  'campaign_plan_db',
] as const
export const RaceOpponentSourceTypeSchema = z.enum(
  RACE_OPPONENT_SOURCE_TYPE_VALUES,
)
export type RaceOpponentSourceType = z.infer<
  typeof RaceOpponentSourceTypeSchema
>

export const RaceOpponentSchema = z.object({
  id: z.number(),
  opponentName: z.string(),
  sourceType: RaceOpponentSourceTypeSchema,
  sourceUrl: z.string().nullable(),
  // Opaque in Phase 0: the as-collected payload's shape isn't known yet, so we
  // deliberately don't model it.
  content: z.unknown(),
  collectedAt: z.coerce.date(),
})
export type RaceOpponent = z.infer<typeof RaceOpponentSchema>

export const RACE_OPPONENT_COLLECTION_STATUS_VALUES = [
  'idle',
  // Opponents aren't known yet: opposition_research is identifying them (or its
  // auto-chained collection is pending) before collection can begin.
  'discovering',
  'running',
  'completed',
  'failed',
] as const
export const RaceOpponentCollectionStatusSchema = z.enum(
  RACE_OPPONENT_COLLECTION_STATUS_VALUES,
)
export type RaceOpponentCollectionStatus = z.infer<
  typeof RaceOpponentCollectionStatusSchema
>

// Grouped-by-opponent response the webapp page renders; the persisted rows are
// flat and the read endpoint does the grouping.
export const RaceOpponentResponseSchema = z.object({
  opponents: z.array(
    z.object({
      opponentName: z.string(),
      items: z.array(RaceOpponentSchema),
    }),
  ),
  lastCollectedAt: z.coerce.date().nullable(),
  collectionStatus: RaceOpponentCollectionStatusSchema,
})
export type RaceOpponentResponse = z.infer<typeof RaceOpponentResponseSchema>
