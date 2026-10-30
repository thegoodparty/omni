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
  // People with an imported email address. Always 0 for an organization
  // without imported contacts, since the voter file carries no emails.
  email: z.number().int().min(0).nullable(),
  // Polls are delivered by text, so reachability mirrors sms 1:1.
  polls: z.number().int().min(0).nullable(),
})
export type ListDetailReachability = z.infer<
  typeof ListDetailReachabilitySchema
>

// The people only an import added (new contacts) a Win campaign can reach on
// each channel, counted next to `reachability` rather than inside it.
export const NewContactsReachableSchema = z.object({
  sms: z.number().int().min(0),
  robocall: z.number().int().min(0),
  phoneBanking: z.number().int().min(0),
  doorKnocking: z.number().int().min(0),
  email: z.number().int().min(0),
  polls: z.number().int().min(0),
})
export type NewContactsReachable = z.infer<typeof NewContactsReachableSchema>

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

// For a Win campaign with imported contacts, `demographics.people` and every
// `reachability` channel count voters only, and the new contacts come back
// beside them; a channel reaches `reachability[c] + newContactsReachable[c]`.
// Absent for Serve and for a campaign without imported contacts, whose
// counts are everyone as before.
export const ListDetailContactsResponseSchema = z.object({
  demographics: ListDetailDemographicsSchema,
  reachability: ListDetailReachabilitySchema,
  outreachHistory: z.array(ListDetailOutreachHistoryEntrySchema),
  newContactsCount: z.number().int().min(0).optional(),
  newContactsReachable: NewContactsReachableSchema.optional(),
})
export type ListDetailContactsResponse = z.infer<
  typeof ListDetailContactsResponseSchema
>
