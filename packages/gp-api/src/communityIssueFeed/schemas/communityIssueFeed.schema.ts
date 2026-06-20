import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const CommunityIssueFeedListQuerySchema = z.object({
  list: z.enum(['top_community', 'trending']),
})

export class CommunityIssueFeedListQueryDto extends createZodDto(
  CommunityIssueFeedListQuerySchema,
) {}

export const CommunityIssueFeedCardSchema = z.object({
  id: z.string(),
  list: z.string(),
  category: z.string(),
  priority: z.string(),
  title: z.string(),
  summary: z.string(),
  rank: z.number().int().nullable(),
  prioritized: z.boolean(),
})

export const CommunityIssueFeedListResponseSchema = z.object({
  issues: z.array(CommunityIssueFeedCardSchema),
  refresh: z.object({
    status: z.enum(['running', 'completed', 'failed']),
    lastCompletedAt: z.string().nullable(),
  }),
})

export const CommunityIssueFeedDetailSchema =
  CommunityIssueFeedCardSchema.extend({
    archived: z.boolean(),
    detail: z.record(z.unknown()).nullable(),
    relatedBriefings: z.array(
      z.object({
        meetingBriefingId: z.string(),
        briefingItemId: z.string(),
        meetingDate: z.string(),
      }),
    ),
    prioritized: z.boolean(),
    priorityId: z.string().nullable(),
  })

export const DispatchRequestSchema = z.object({
  orgSlugs: z.array(z.string()).min(1).max(200),
})

export class DispatchRequestDto extends createZodDto(DispatchRequestSchema) {}

export const DispatchResponseSchema = z.object({
  dispatched: z.number(),
  skipped: z.number(),
})

const IssueIdParamSchema = z.object({ id: z.string() })

export class IssueIdParamDto extends createZodDto(IssueIdParamSchema) {}
