import { z } from 'zod'

// Narrow projection of the briefing artifact JSONB used for card generation.
// The artifact's full shape is MeetingBriefingFull (agent-job-contracts);
// executive_summary.items[] is the already-curated featured set, so each
// entry maps to one agenda_item card. Lenient parsing: a missing or malformed
// optional section yields no cards for that section rather than throwing.
export const ExecutiveSummaryItemSchema = z.object({
  item_id: z.string(),
  title: z.string(),
  overview: z.string(),
})

export const BriefingArtifactCardSourceSchema = z.object({
  meeting_date: z.string(),
  meeting_name: z.string().optional(),
  executive_summary: z
    .object({
      items: z.array(ExecutiveSummaryItemSchema).optional(),
      lead_in: z.string().optional(),
      subheadline: z.string().optional(),
      headline: z.string().optional(),
    })
    .optional(),
})

export type BriefingArtifactCardSource = z.infer<
  typeof BriefingArtifactCardSourceSchema
>
export type ExecutiveSummaryItem = z.infer<typeof ExecutiveSummaryItemSchema>
