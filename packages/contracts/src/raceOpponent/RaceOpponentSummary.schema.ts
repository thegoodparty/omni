import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { RaceOpponentSourceTypeSchema } from './RaceOpponentSourceType.schema'

// Rich source ref (ENG-10630): powers the hover-card source carousel. Replaces
// the legacy {sourceType, sourceUrl} ref as the shape agents emit going
// forward.
export const SummarySourceSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  description: z.string().optional(),
})
export type SummarySource = z.infer<typeof SummarySourceSchema>

const SummarySourceRefSchema = z.object({
  sourceType: RaceOpponentSourceTypeSchema,
  sourceUrl: z.string().min(1),
})
export type SummarySourceRef = z.infer<typeof SummarySourceRefSchema>

// A legacy sourceUrl is just z.string().min(1) upstream, not URL-validated, so
// a malformed value is a nameable input here; falling back to the raw string
// keeps the read endpoint from 500ing on an old row instead of throwing.
const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// Union-normalized source: legacy rows persisted {sourceType, sourceUrl}; v2
// rows persist the rich shape directly. Both normalize to SummarySource so
// every consumer reads one shape. Same precedent as the ENG-10621
// WhatYouNeedToKnowItemSchema normalization below.
const NormalizedSummarySourceSchema = z
  .union([SummarySourceSchema, SummarySourceRefSchema])
  .transform((source) =>
    'url' in source
      ? source
      : {
          url: source.sourceUrl,
          title: hostnameOf(source.sourceUrl),
          publisher: hostnameOf(source.sourceUrl),
        },
  )

// sourced-or-silent: a displayed section must carry at least one source so the
// UI can never render an unattributed claim.
const SummarySectionSchema = z.object({
  text: z.string(),
  sources: z.array(NormalizedSummarySourceSchema).min(1),
})
export type SummarySection = z.infer<typeof SummarySectionSchema>

const SummaryKeyPositionSchema = z.object({
  label: z.string(),
  detail: z.string(),
  sources: z.array(NormalizedSummarySourceSchema).min(1),
})
export type SummaryKeyPosition = z.infer<typeof SummaryKeyPositionSchema>

// Phase 3 analytical fields. Relaxed sourcing: unlike the sourced-or-silent
// SummarySection above, where-soft items and issue contrasts cite a source
// only where there is a direct basis, and the interpretive fields (threatTier,
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

// A relaxed-sourced text item: prose plus optional citations. Cites a source
// only where the item rests directly on the collected text.
const SourcedTextItemSchema = z.object({
  text: z.string(),
  sources: z.array(NormalizedSummarySourceSchema).optional(),
})
export type WhereSoftItem = z.infer<typeof SourcedTextItemSchema>

// what_you_need_to_know migrated from a bare string[] to {text, sources?}[]
// (ENG-10621). Accept the legacy string form and normalize it to { text }:
// summaries persisted before the migration are stored as a JSONB blob and
// re-validated through this schema on read, so without this a legacy row fails
// validation and the summary is silently dropped from the response.
const WhatYouNeedToKnowItemSchema = z
  .union([z.string(), SourcedTextItemSchema])
  .transform((item) => (typeof item === 'string' ? { text: item } : item))
export type WhatYouNeedToKnowItem = z.infer<typeof WhatYouNeedToKnowItemSchema>

const IssueContrastSchema = z.object({
  issue: z.string(),
  salience: IssueSalienceSchema,
  whyItMatters: z.string(),
  opponentStance: z.string(),
  opponentSources: z.array(NormalizedSummarySourceSchema).optional(),
  candidateStance: z.string(),
})
export type IssueContrast = z.infer<typeof IssueContrastSchema>

// Campaign-level SWOT (ENG-10630/ENG-10631): derived from candidate_platform +
// opponent web sources, persisted once per campaign (not per opponent).
export const RaceOpponentFieldAnalysisSchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  opportunities: z.array(z.string()),
  threats: z.array(z.string()),
  // Interpretive section: sourcing is optional/empty, unlike the
  // sourced-or-silent sections above.
  sources: z.array(SummarySourceSchema).default([]),
  generatedAt: zCoerceDate().nullable(),
})
export type RaceOpponentFieldAnalysis = z.infer<
  typeof RaceOpponentFieldAnalysisSchema
>

export const RaceOpponentSummarySchema = z.object({
  opponentName: z.string(),
  overview: SummarySectionSchema.nullable(),
  background: SummarySectionSchema.nullable(),
  generatedAt: zCoerceDate().nullable(),
  // Phase 3: the whole analysis block may be absent for an opponent with no
  // analysis yet, so every analytical field is optional.
  threatTier: RaceOpponentThreatTierSchema.optional(),
  // v2 (ENG-10630): interpretive, no required sources.
  whyTheyreRunning: z.object({ text: z.string() }).nullish(),
  // v2 (ENG-10630): sourced-or-silent, like overview/background.
  issuesThatMatter: z
    .object({
      items: z.array(z.string()).min(1),
      sources: z.array(NormalizedSummarySourceSchema).min(1),
    })
    .nullish(),
  // Dropped from the v2 output schema (ENG-10629); kept optional so legacy
  // persisted rows still parse. The UI stops rendering these.
  keyPositions: z.array(SummaryKeyPositionSchema).optional(),
  whyTheyMatter: z.string().optional(),
  whatYouNeedToKnow: z.array(WhatYouNeedToKnowItemSchema).optional(),
  whereSoft: z.array(SourcedTextItemSchema).optional(),
  issueContrasts: z.array(IssueContrastSchema).optional(),
})
export type RaceOpponentSummary = z.infer<typeof RaceOpponentSummarySchema>
