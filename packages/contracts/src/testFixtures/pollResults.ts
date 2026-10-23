import { z } from 'zod'

export const SeedPollResultsRequestSchema = z.object({
  personId: z.string().min(1),
  issueTitle: z.string().min(1),
  issueSummary: z.string().min(1),
})
export type SeedPollResultsRequest = z.infer<
  typeof SeedPollResultsRequestSchema
>

export const SeedPollResultsResponseSchema = z.object({
  pollId: z.string(),
  pollName: z.string(),
})
export type SeedPollResultsResponse = z.infer<
  typeof SeedPollResultsResponseSchema
>
