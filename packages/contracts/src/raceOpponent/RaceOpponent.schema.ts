import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { RaceOpponentSourceTypeSchema } from './RaceOpponentSourceType.schema'
import {
  RaceOpponentFieldAnalysisSchema,
  RaceOpponentSummarySchema,
  RaceOpponentThreatTierSchema,
} from './RaceOpponentSummary.schema'

export const RaceOpponentSchema = z.object({
  id: z.number(),
  opponentName: z.string(),
  sourceType: RaceOpponentSourceTypeSchema,
  sourceUrl: z.string().nullable(),
  // Opaque in Phase 0: the as-collected payload's shape isn't known yet, so we
  // deliberately don't model it.
  content: z.unknown(),
  collectedAt: zCoerceDate(),
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
      // Enriched from the campaign-strategy opponent roster by name match;
      // null when the collected name doesn't match a roster row (don't guess).
      party: z.string().nullable(),
      isIncumbent: z.boolean().nullable(),
      // Phase 3: surfaced on the opponent object (in addition to summary) so the
      // roster can tier and order without opening the detail. Optional until an
      // opponent has analysis.
      threatTier: RaceOpponentThreatTierSchema.optional(),
      // Raw per-source research rows. Sent only as the no-summary fallback the
      // page renders when an opponent has no structured summary yet; once a
      // summary exists these are redundant and gp-api omits them rather than
      // shipping the full scraped page text (ENG-10622). Optional for that
      // omit.
      items: z.array(RaceOpponentSchema).optional(),
      // Optional + nullable: ENG-10588 wires the producer to populate this from
      // the race_opponent_summary step. Until then gp-api's get() omits the
      // field, so it must be optional (not just nullable) to validate.
      summary: RaceOpponentSummarySchema.nullish(),
      // v2 (ENG-10630): populated from the opponent's roster/collected data;
      // nullish so older gp-api payloads that predate this field still parse.
      websiteUrl: z.string().nullish(),
    }),
  ),
  lastCollectedAt: zCoerceDate().nullable(),
  collectionStatus: RaceOpponentCollectionStatusSchema,
  // v2 (ENG-10630): campaign-level SWOT, null until candidate_platform data is
  // available; nullish so older gp-api payloads still parse.
  fieldAnalysis: RaceOpponentFieldAnalysisSchema.nullish(),
})
export type RaceOpponentResponse = z.infer<typeof RaceOpponentResponseSchema>
