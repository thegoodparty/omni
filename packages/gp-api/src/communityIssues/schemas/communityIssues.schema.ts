import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import {
  CommunityIssuesDispatchRequestSchema,
  CommunityIssuesDispatchResultSchema,
} from '@goodparty_org/contracts'
import {
  CommunityIssueCategory,
  CommunityIssuePriority,
} from '../../generated/prisma'
import { DetailSchema } from '../communityIssueArtifact.validation'

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
  detail: z.record(z.string(), z.unknown()).nullable(),
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

export const DispatchRequestSchema = CommunityIssuesDispatchRequestSchema

export class DispatchRequestDto extends createZodDto(DispatchRequestSchema) {}

export const DispatchResponseSchema = CommunityIssuesDispatchResultSchema

export const SelfDispatchRequestSchema = z.object({
  type: z.enum(['top_community_issues', 'trending_issues']),
})

export class SelfDispatchRequestDto extends createZodDto(
  SelfDispatchRequestSchema,
) {}

const IssueIdParamSchema = z.object({ id: z.string() })

export class IssueIdParamDto extends createZodDto(IssueIdParamSchema) {}

// Preview/dev-only deterministic seeding for e2e tests. Mirrors the shape an
// agent run ultimately persists (the issue rows reach the DB via the same
// upsertFromArtifact path the SQS completion handler calls), plus an optional
// related meeting briefing link. Disabled on qa/prod by the service.
const SeedRelatedBriefingSchema = z.object({
  meetingDate: z.string(),
  briefingItemId: z.string(),
  content: z.string(),
})

const SeedIssueSchema = z.object({
  list: z.enum(['top_community', 'trending']),
  category: z.nativeEnum(CommunityIssueCategory),
  priority: z.nativeEnum(CommunityIssuePriority),
  title: z.string(),
  summary: z.string(),
  rank: z.number().int(),
  detail: DetailSchema,
  relatedBriefing: SeedRelatedBriefingSchema.optional(),
})

// Mirrors the real pipeline's envelope cap: an artifact carries at most 10
// issues per list, so seeded data can never exceed what production produces.
export const SeedRequestSchema = z.object({
  issues: z
    .array(SeedIssueSchema)
    .min(1)
    .max(20)
    .superRefine((issues, ctx) => {
      for (const list of ['top_community', 'trending'] as const) {
        if (issues.filter((i) => i.list === list).length > 10) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `no more than 10 issues per list (${list})`,
          })
        }
      }
    }),
})

export class SeedRequestDto extends createZodDto(SeedRequestSchema) {}

export const SeedResponseSchema = z.object({
  issues: z.array(
    z.object({
      id: z.string(),
      list: z.string(),
      rank: z.number().int().nullable(),
      title: z.string(),
    }),
  ),
})
