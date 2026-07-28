import { z } from 'zod'

// people-api's POST /v1/people/aggregates response (ENG-10706): a filtered
// COUNT/AVG(age)/AVG(income) over a saved list's membership. `fenced`
// (ENG-10775) is true when people-api's statement-timeout guard fired and
// this count/avgAge/avgIncome were computed over the FENCE_LIMIT-capped
// fallback query rather than the full filtered set — a lower bound/sample,
// not an exact figure. Optional so a producer/consumer on either side of a
// deploy window (people-api and gp-api deploy independently) still validates
// against this schema without the field.
export const PeopleAggregatesResponseSchema = z.object({
  count: z.number().int().min(0),
  avgAge: z.number().nullable(),
  avgIncome: z.number().nullable(),
  fenced: z.boolean().optional(),
})
export type PeopleAggregatesResponse = z.infer<
  typeof PeopleAggregatesResponseSchema
>
