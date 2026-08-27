import { z } from 'zod'
import { OutreachDetailSchema } from './OutreachSocial.schema'

// Cancel-before-send (SMS): the response reads from the persisted row, and
// `refunded` reports whether a Stripe refund was actually created on this
// call — free-texts campaigns cancel without one.
export const CancelOutreachResponseSchema = z.object({
  outreach: OutreachDetailSchema,
  refunded: z.boolean(),
})
export type CancelOutreachResponse = z.infer<
  typeof CancelOutreachResponseSchema
>
