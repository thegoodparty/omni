import { z } from 'zod'

// Candidate-facing per-campaign text results (the details sheet's
// Statistics card): counts only — reply content never leaves the CRM.
// Percentages are presentation and stay client-side.
export const SmsOutreachResultsSchema = z.object({
  // Recipients the campaign addressed: the per-recipient interaction rows
  // when they exist, else the billable/text count recorded at purchase.
  contacts: z.number(),
  responded: z.number(),
  optedOut: z.number(),
})
export type SmsOutreachResults = z.infer<typeof SmsOutreachResultsSchema>
