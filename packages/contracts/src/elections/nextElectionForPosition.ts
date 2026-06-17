import { z } from 'zod'

// Response of election-api `GET /positions/:id/next-election`. The position's
// nearest upcoming general election day (yyyy-mm-dd), or null when the position
// has no future race. gp-api uses it to date a re-election campaign; null means
// the caller must fall back to another source rather than date the campaign to
// a past election.
export const NextElectionForPositionSchema = z.object({
  electionDate: z.string().nullable(),
})

export type NextElectionForPosition = z.infer<
  typeof NextElectionForPositionSchema
>
