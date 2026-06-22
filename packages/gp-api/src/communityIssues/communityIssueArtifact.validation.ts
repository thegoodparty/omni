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
  source_type: z.enum(['news', 'government_website', 'research', 'poll']),
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

const DetailSchema = z
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

const ArtifactSchema = z.object({
  schema_version: z.literal(1),
  list: z.enum(['top_community', 'trending']),
  organization_slug: z.string(),
  generated_for_run_id: z.string(),
  data_quality: z.enum(['ok', 'partial', 'insufficient_signal']),
  data_quality_reason: z.string().optional(),
  issues: z.array(IssueSchema).max(10),
  notes: z.string().optional(),
  sources_used: z.array(z.string()).optional(),
})

export type CommunityIssuesArtifact = z.infer<typeof ArtifactSchema>

export const validateCommunityIssuesArtifact = (
  raw: unknown,
):
  | { ok: true; artifact: CommunityIssuesArtifact }
  | { ok: false; reason: string } => {
  const result = ArtifactSchema.safeParse(raw)
  if (result.success) return { ok: true, artifact: result.data }
  return { ok: false, reason: result.error.message }
}
