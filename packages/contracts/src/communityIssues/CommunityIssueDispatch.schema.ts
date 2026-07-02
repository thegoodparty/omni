import { z } from 'zod'

export const CommunityIssuesDispatchRequestSchema = z.object({
  orgSlugs: z.array(z.string()).min(1).max(200),
})

export type CommunityIssuesDispatchRequest = z.infer<
  typeof CommunityIssuesDispatchRequestSchema
>

// Per-type dispatch counts across the cohort: each org contributes up to two
// dispatches (top_community_issues + trending_issues); gate skips and
// in-flight dedupes land in `skipped`.
export const CommunityIssuesDispatchResultSchema = z.object({
  dispatched: z.number(),
  skipped: z.number(),
})

export type CommunityIssuesDispatchResult = z.infer<
  typeof CommunityIssuesDispatchResultSchema
>
