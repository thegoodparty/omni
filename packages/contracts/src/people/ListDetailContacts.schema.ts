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
  sms: z.number().int().min(0),
  robocall: z.number().int().min(0),
  phoneBanking: z.number().int().min(0),
  doorKnocking: z.number().int().min(0),
  // No eligibility data source exists for either channel (TDD open
  // question) — always null so the UI renders "unavailable", never 0.
  email: z.null(),
  metaAds: z.null(),
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
