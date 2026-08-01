import { z } from 'zod'

// people-api's POST /v1/people/aggregates response (ENG-10706): a filtered
// COUNT/AVG(age)/AVG(income) over a saved list's membership.
export const PeopleAggregatesResponseSchema = z.object({
  count: z.number().int().min(0),
  avgAge: z.number().nullable(),
  avgIncome: z.number().nullable(),
})
export type PeopleAggregatesResponse = z.infer<
  typeof PeopleAggregatesResponseSchema
>
