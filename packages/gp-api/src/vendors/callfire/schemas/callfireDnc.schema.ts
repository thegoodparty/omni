import { z } from 'zod'

// A DNC entry from GET /contacts/dncs. We only need `number` (CallFire stores
// it E.164 11-digit, e.g. 12132000384); `call` marks it a Do-Not-Call entry
// (we already filter the query with ?call=true).
export const CallfireDoNotContactSchema = z.object({
  number: z.string(),
  call: z.boolean().nullish(),
})
export type CallfireDoNotContact = z.infer<typeof CallfireDoNotContactSchema>

// The standard CallFire Page envelope. Per the Swagger Page docs, when
// items.length < limit there are no further pages.
export const DoNotContactPageSchema = z.object({
  items: z.array(CallfireDoNotContactSchema).nullish(),
  limit: z.number().int().nullish(),
  offset: z.number().int().nullish(),
  totalCount: z.number().int().nullish(),
})
export type DoNotContactPage = z.infer<typeof DoNotContactPageSchema>
