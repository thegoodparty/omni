import { z } from 'zod'
import {
  CommunityIssueCategory,
  CommunityIssuePriority,
} from '../generated/prisma'

const SourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  retrieved_at: z.string(),
  retrieved_text_or_snapshot: z.string(),
  source_type: z.enum([
    'news',
    'government_website',
    'research',
    'poll',
    'advocacy_org',
  ]),
  url: z.string().nullish(),
  publisher: z.string().nullish(),
  article_date: z.string().nullish(),
  article_type: z
    .enum([
      'reporting',
      'opinion',
      'editorial',
      'press_release',
      'government_communication',
    ])
    .nullish(),
})

const SectionWithSourceIds = z.object({
  source_ids: z.array(z.string()),
  summary: z.string(),
})

export const DetailSchema = z
  .object({
    sources: z.array(SourceSchema),
    overview: SectionWithSourceIds,
    history: SectionWithSourceIds.optional(),
    legislation: SectionWithSourceIds.optional(),
    research: SectionWithSourceIds.optional(),
    quotes: z
      .object({
        items: z.array(
          z.object({
            source_id: z.string(),
            text: z.string(),
            attribution: z.string().optional(),
          }),
        ),
      })
      .optional(),
  })
  .superRefine((detail, ctx) => {
    const sourceIds = new Set(detail.sources.map((s) => s.id))

    const checkIds = (ids: string[], path: string) => {
      for (const id of ids) {
        if (!sourceIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `source_id "${id}" in ${path} not found in detail.sources`,
          })
        }
      }
    }

    checkIds(detail.overview.source_ids, 'overview.source_ids')
    if (detail.history)
      checkIds(detail.history.source_ids, 'history.source_ids')
    if (detail.legislation)
      checkIds(detail.legislation.source_ids, 'legislation.source_ids')
    if (detail.research)
      checkIds(detail.research.source_ids, 'research.source_ids')
    if (detail.quotes) {
      for (const item of detail.quotes.items) {
        checkIds([item.source_id], 'quotes.items[].source_id')
      }
    }
  })

const IssueSchema = z.object({
  category: z.nativeEnum(CommunityIssueCategory),
  rank: z.number(),
  priority: z.nativeEnum(CommunityIssuePriority),
  title: z.string(),
  summary: z.string(),
  existing_issue_id: z.string().optional(),
  detail: DetailSchema,
})

export type CommunityIssuesArtifactIssue = z.infer<typeof IssueSchema>

// The envelope is validated strictly (its fields are required and several map
// to real DB enum columns). Issues are validated individually below so one
// malformed issue does not discard a whole run's worth of good ones — the
// max(10) cap stays here because it's an envelope-level invariant.
const ArtifactEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  list: z.enum(['top_community', 'trending']),
  organization_slug: z.string(),
  generated_for_run_id: z.string(),
  data_quality: z.enum(['ok', 'partial', 'insufficient_signal']),
  data_quality_reason: z.string().optional(),
  issues: z.array(z.unknown()).max(10),
  notes: z.string().optional(),
  sources_used: z.array(z.string()).optional(),
})

export type CommunityIssuesArtifact = Omit<
  z.infer<typeof ArtifactEnvelopeSchema>,
  'issues'
> & { issues: CommunityIssuesArtifactIssue[] }

export type DroppedIssue = { index: number; reason: string }

// Returns ok:false only when the envelope itself is invalid. A valid envelope
// always returns ok:true with the issues that passed IssueSchema; any that
// failed are reported in `dropped` (and the caller persists the remainder).
export const validateCommunityIssuesArtifact = (
  raw: unknown,
):
  | { ok: true; artifact: CommunityIssuesArtifact; dropped: DroppedIssue[] }
  | { ok: false; reason: string } => {
  const envelope = ArtifactEnvelopeSchema.safeParse(raw)
  if (!envelope.success) return { ok: false, reason: envelope.error.message }

  const issues: CommunityIssuesArtifactIssue[] = []
  const dropped: DroppedIssue[] = []
  envelope.data.issues.forEach((rawIssue, index) => {
    const result = IssueSchema.safeParse(rawIssue)
    if (result.success) issues.push(result.data)
    else dropped.push({ index, reason: result.error.message })
  })

  return { ok: true, artifact: { ...envelope.data, issues }, dropped }
}
