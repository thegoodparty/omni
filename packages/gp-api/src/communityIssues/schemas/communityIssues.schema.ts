import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const CommunityIssueListQuerySchema = z.object({
  list: z.enum(['top_community', 'trending']),
})

export class CommunityIssueListQueryDto extends createZodDto(
  CommunityIssueListQuerySchema,
) {}

export const CommunityIssueCardSchema = z.object({
  id: z.string(),
  list: z.string(),
  category: z.string(),
  priority: z.string(),
  title: z.string(),
  summary: z.string(),
  rank: z.number().int().nullable(),
  prioritized: z.boolean(),
})

export const CommunityIssueListResponseSchema = z.object({
  issues: z.array(CommunityIssueCardSchema),
  refresh: z.object({
    status: z.enum(['running', 'completed', 'failed']),
    lastCompletedAt: z.string().nullable(),
  }),
})

export const CommunityIssueDetailSchema = CommunityIssueCardSchema.extend({
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

export const SelfDispatchRequestSchema = z.object({
  type: z.enum(['top_community_issues', 'trending_issues']),
})

export class SelfDispatchRequestDto extends createZodDto(
  SelfDispatchRequestSchema,
) {}

const IssueIdParamSchema = z.object({ id: z.string() })

export class IssueIdParamDto extends createZodDto(IssueIdParamSchema) {}
