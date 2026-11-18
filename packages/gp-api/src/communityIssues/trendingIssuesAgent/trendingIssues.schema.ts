import { z } from 'zod'

// The trending_issues manifest's input_schema, in gp-api's names, plus the
// run's date: the old runner's model read it from its environment, and the
// 90-day rule needs it.
export const TrendingIssuesInputSchema = z.object({
  organizationSlug: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  office: z.string().min(1),
  districtDescriptor: z.string().min(1),
  today: z.iso.date(),
})

const SubsectionSchema = z.strictObject({
  summary: z.string().min(1),
  source_ids: z.array(z.string().min(1)),
})

const SourceSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  source_type: z.enum([
    'news',
    'government_website',
    'research',
    'poll',
    'advocacy_org',
  ]),
  url: z
    .string()
    .regex(/^https?:\/\//)
    .nullish(),
  publisher: z.string().nullish(),
  article_type: z
    .enum([
      'reporting',
      'opinion',
      'editorial',
      'press_release',
      'government_communication',
    ])
    .nullish(),
  article_date: z.iso.date().nullish(),
  retrieved_at: z.iso.datetime({ offset: true }),
  retrieved_text_or_snapshot: z.string().min(1).max(50000),
})

const IssueOutputSchema = z.strictObject({
  existing_issue_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'ID of the existing community issue in the feed, if this issue already exists.',
    ),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  category: z.enum([
    'infrastructure_and_transportation',
    'public_safety',
    'education',
    'housing_and_development',
    'health_and_human_services',
    'economic_development',
    'quality_of_life',
    'government_operations',
    'other',
  ]),
  priority: z.enum(['low', 'medium', 'high']),
  rank: z.int().min(1),
  detail: z.strictObject({
    sources: z.array(SourceSchema),
    overview: SubsectionSchema,
    history: SubsectionSchema.optional(),
    quotes: z
      .strictObject({
        items: z.array(
          z.strictObject({
            text: z.string().min(1),
            attribution: z.string().optional(),
            source_id: z.string().min(1),
          }),
        ),
      })
      .optional(),
    research: SubsectionSchema.optional(),
    legislation: SubsectionSchema.optional(),
  }),
})

// The manifest's output_schema without organization_slug and
// generated_for_run_id: gp-api knows both, so the model is not asked to echo
// them (trendingIssuesArtifact adds them back).
export const TrendingIssuesOutputSchema = z.strictObject({
  schema_version: z.literal(1),
  list: z.literal('trending'),
  issues: z.array(IssueOutputSchema).max(5),
  sources_used: z.array(z.string().min(1)).optional(),
  data_quality: z.enum(['ok', 'partial', 'insufficient_signal']),
  data_quality_reason: z.string().optional(),
  notes: z.string().optional(),
})
export type TrendingIssuesOutput = z.infer<typeof TrendingIssuesOutputSchema>

// The artifact the PMF Engine's run publishes, so the ingest path and the
// judge read one shape from either engine.
export const trendingIssuesArtifact = (
  output: TrendingIssuesOutput,
  run: { runId: string; organizationSlug: string },
) => ({
  ...output,
  organization_slug: run.organizationSlug,
  generated_for_run_id: run.runId,
})
