import { z } from 'zod'
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

export const RaceOpponentSummarySchema = z.object({
  opponentName: z.string(),
  overview: SummarySectionSchema.nullable(),
  background: SummarySectionSchema.nullable(),
  keyPositions: z.array(SummaryKeyPositionSchema),
  generatedAt: z.coerce.date().nullable(),
})
export type RaceOpponentSummary = z.infer<typeof RaceOpponentSummarySchema>
