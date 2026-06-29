import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { RaceOpponentSourceTypeSchema } from './RaceOpponentSourceType.schema'

const SummarySourceRefSchema = z.object({
  sourceType: RaceOpponentSourceTypeSchema,
  sourceUrl: z.string().min(1),
})
export type SummarySourceRef = z.infer<typeof SummarySourceRefSchema>

// sourced-or-silent: a displayed section must carry at least one source so the
// UI can never render an unattributed claim.
const SummarySectionSchema = z.object({
  text: z.string(),
  sources: z.array(SummarySourceRefSchema).min(1),
})
export type SummarySection = z.infer<typeof SummarySectionSchema>

const SummaryKeyPositionSchema = z.object({
  label: z.string(),
  detail: z.string(),
  sources: z.array(SummarySourceRefSchema).min(1),
})
export type SummaryKeyPosition = z.infer<typeof SummaryKeyPositionSchema>

// Phase 3 analytical fields. Relaxed sourcing: unlike the sourced-or-silent
// SummarySection above, where-soft items and issue contrasts cite a source only
// where there is a direct basis, and the interpretive fields (threatTier,
// salience) carry no source at all.
export const RaceOpponentThreatTierSchema = z.enum([
  'primary_threat',
  'watch_closely',
  'low_priority',
])
export type RaceOpponentThreatTier = z.infer<
  typeof RaceOpponentThreatTierSchema
>

export const IssueSalienceSchema = z.enum(['high', 'medium', 'low'])
export type IssueSalience = z.infer<typeof IssueSalienceSchema>

const WhereSoftItemSchema = z.object({
  text: z.string(),
  sources: z.array(SummarySourceRefSchema).optional(),
})
export type WhereSoftItem = z.infer<typeof WhereSoftItemSchema>

const IssueContrastSchema = z.object({
  issue: z.string(),
  salience: IssueSalienceSchema,
  whyItMatters: z.string(),
  opponentStance: z.string(),
  opponentSources: z.array(SummarySourceRefSchema).optional(),
  candidateStance: z.string(),
})
export type IssueContrast = z.infer<typeof IssueContrastSchema>

export const RaceOpponentSummarySchema = z.object({
  opponentName: z.string(),
  overview: SummarySectionSchema.nullable(),
  background: SummarySectionSchema.nullable(),
  keyPositions: z.array(SummaryKeyPositionSchema),
  generatedAt: zCoerceDate().nullable(),
  // Phase 3: the whole analysis block may be absent for an opponent with no
  // analysis yet, so every analytical field is optional.
  threatTier: RaceOpponentThreatTierSchema.optional(),
  whyTheyMatter: z.string().optional(),
  whatYouNeedToKnow: z.array(z.string()).optional(),
  whereSoft: z.array(WhereSoftItemSchema).optional(),
  issueContrasts: z.array(IssueContrastSchema).optional(),
})
export type RaceOpponentSummary = z.infer<typeof RaceOpponentSummarySchema>
