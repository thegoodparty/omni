import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// The request runs synchronously and dispatches serially, so `limit` is capped
// to keep one call well inside the load balancer's idle timeout. Widen the
// backlog by calling again: the cohort query never re-selects a campaign whose
// plan is persisted, so repeated calls walk the backlog without double spend.
export const BACKFILL_PLANS_MAX_LIMIT = 50

export const BACKFILL_PLANS_PREVIEW_SIZE = 20

// Rough per-campaign cost: two plan sections plus the tracker generation the
// completion handler dispatches. An order of magnitude for the dry run, not
// an invoice.
export const APPROX_COST_PER_CAMPAIGN_USD = 2

// The campaign-story gate came off on 2026-10-02 (#2307). Campaigns created
// before the gate went on already had a plan generated at sign-up, so the
// stranded cohort starts where the gate did.
export const BACKFILL_PLANS_DEFAULT_CREATED_SINCE = '2026-09-01'

export const BackfillPlansRequestSchema = z.object({
  apply: z.boolean().default(false),
  limit: z.number().int().min(1).max(BACKFILL_PLANS_MAX_LIMIT).default(10),
  createdSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default(BACKFILL_PLANS_DEFAULT_CREATED_SINCE),
})

export type BackfillPlansInput = z.infer<typeof BackfillPlansRequestSchema>

export class BackfillPlansRequestDto extends createZodDto(
  BackfillPlansRequestSchema,
) {}

const CampaignPreviewSchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  electionDate: z.string().nullable(),
})

export const BackfillPlansResponseSchema = z.object({
  apply: z.boolean(),
  createdSince: z.string(),
  eligible: z.number(),
  testCampaignsSkipped: z.number(),
  selected: z.number(),
  approxCostUsd: z.number(),
  preview: z.array(CampaignPreviewSchema),
  outcomes: z
    .object({
      dispatched: z.number(),
      skipped: z.number(),
      failed: z.number(),
      failures: z.array(z.object({ id: z.number(), reason: z.string() })),
    })
    .nullable(),
})

export type BackfillPlansResponse = z.infer<typeof BackfillPlansResponseSchema>
