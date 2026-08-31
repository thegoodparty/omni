import { z } from 'zod'
import { OutreachStatusSchema, OutreachTypeSchema } from '../generated/enums'
import { zDate } from '../shared/Date.schema'

// GET /v1/contacts/list-detail response (ENG-10706): demographics +
// reachable-by-channel counts + outreach history for one saved list.
// Produced by gp-api (via people-api's POST /v1/people/aggregates) and
// consumed by gp-webapp's list-detail page — living here keeps the two from
// drifting.
export const ListDetailDemographicsSchema = z.object({
  people: z.number().int().min(0),
  avgAge: z.number().nullable(),
  avgIncome: z.number().nullable(),
})
export type ListDetailDemographics = z.infer<
  typeof ListDetailDemographicsSchema
>

export const ListDetailReachabilitySchema = z.object({
  // Nullable for the webapp's "Unavailable" tile only. gp-api now derives
  // every channel from one conditional-aggregate statement alongside the
  // demographics, so a channel is null only if the whole payload is missing —
  // which fails the route instead (see fetchListDetailAggregates).
  sms: z.number().int().min(0).nullable(),
  robocall: z.number().int().min(0).nullable(),
  phoneBanking: z.number().int().min(0).nullable(),
  doorKnocking: z.number().int().min(0).nullable(),
  // Polls are delivered by text, so reachability mirrors sms 1:1.
  polls: z.number().int().min(0).nullable(),
})
export type ListDetailReachability = z.infer<
  typeof ListDetailReachabilitySchema
>

export const ListDetailOutreachHistoryEntrySchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  outreachType: OutreachTypeSchema,
  status: OutreachStatusSchema.nullable(),
  date: zDate().nullable(),
  // ENG-10776: a legacy row can have a null `date` — the webapp falls back
  // to this to render a real timestamp instead of "—".
  createdAt: zDate(),
})
export type ListDetailOutreachHistoryEntry = z.infer<
  typeof ListDetailOutreachHistoryEntrySchema
>

export const ListDetailContactsResponseSchema = z.object({
  demographics: ListDetailDemographicsSchema,
  reachability: ListDetailReachabilitySchema,
  outreachHistory: z.array(ListDetailOutreachHistoryEntrySchema),
})
export type ListDetailContactsResponse = z.infer<
  typeof ListDetailContactsResponseSchema
>
