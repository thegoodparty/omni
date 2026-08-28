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

// The list-detail page's whole aggregate payload from ONE statement: the
// demographics COUNT/AVGs plus a conditional count per reachability channel.
// A channel used to be its own aggregates call, and that five-way fan-out was
// itself the problem — it put a median of nine statements in flight on a
// four-cluster serverless warehouse, which is where the warehouse starts
// provisioning compute and bills a flat multi-second wait for it.
export const PeopleListDetailAggregatesResponseSchema = z.object({
  count: z.number().int().min(0),
  avgAge: z.number().nullable(),
  avgIncome: z.number().nullable(),
  sms: z.number().int().min(0),
  robocall: z.number().int().min(0),
  phoneBanking: z.number().int().min(0),
  doorKnocking: z.number().int().min(0),
})
export type PeopleListDetailAggregatesResponse = z.infer<
  typeof PeopleListDetailAggregatesResponseSchema
>
