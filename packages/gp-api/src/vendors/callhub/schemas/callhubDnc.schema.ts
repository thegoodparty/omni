import { z } from 'zod'

// A DNC (do-not-call) contact entry. CallHub exposes no per-number lookup or
// server-side scrub, only this downloadable list — callers page the whole list
// and diff locally (see CallhubDncService). Verified live: shape is
// { url, dnc, phone_number } in a standard DRF page envelope.
export const CallhubDncContactSchema = z.object({
  phone_number: z.string(),
})
export type CallhubDncContact = z.infer<typeof CallhubDncContactSchema>

export const DncContactsPageSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(CallhubDncContactSchema),
})
export type DncContactsPage = z.infer<typeof DncContactsPageSchema>
