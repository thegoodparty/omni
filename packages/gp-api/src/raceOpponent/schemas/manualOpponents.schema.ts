import { z } from 'zod'

// Candidate-supplied URL hints are optional. When present they must be a
// well-formed https URL — anything else (http, mailto, garbage) is rejected so
// a bad value never reaches the collection agent as a discovery starting point.
const httpsUrl = z
  .string()
  .trim()
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'Must be a valid https URL.' },
  )

export const ManualOpponentsRequestSchema = z.object({
  opponents: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        ballotpediaUrl: httpsUrl.optional(),
        website: httpsUrl.optional(),
      }),
    )
    .min(1)
    .max(10),
})
export type ManualOpponentsRequest = z.infer<
  typeof ManualOpponentsRequestSchema
>
