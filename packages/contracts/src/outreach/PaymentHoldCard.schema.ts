import { z } from 'zod'

export const PaymentHoldCardIntentResponseSchema = z.object({
  clientSecret: z.string(),
})
export type PaymentHoldCardIntentResponse = z.infer<
  typeof PaymentHoldCardIntentResponseSchema
>

export const PaymentHoldCardRequestSchema = z.object({
  paymentMethodId: z.string().min(1),
})
export type PaymentHoldCardRequest = z.infer<
  typeof PaymentHoldCardRequestSchema
>

// held: the hold is on the card now. scheduled: the card is saved and the hold
// is placed a few days before the send. declined: the card was refused;
// declineCode is Stripe's reason, null when it gave none.
export const PaymentHoldCardResponseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('held'), captureBefore: z.string() }),
  z.object({ outcome: z.literal('scheduled') }),
  z.object({
    outcome: z.literal('declined'),
    declineCode: z.string().nullable(),
  }),
])
export type PaymentHoldCardResponse = z.infer<
  typeof PaymentHoldCardResponseSchema
>
