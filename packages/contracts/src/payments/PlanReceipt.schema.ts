import { z } from 'zod'

// Receipt for the campaign's latest paid plan purchase. `amountCents` is what
// was charged after any promo code. The card fields and `receiptUrl` are null
// when no charge backs the purchase (a promo code covered it in full), and
// for Afterpay, which has no card. `paymentMethod` is how it was paid: a
// wallet still carries the card underneath it.
export const PlanReceiptPaymentMethodSchema = z.enum([
  'card',
  'apple_pay',
  'google_pay',
  'afterpay',
])
export type PlanReceiptPaymentMethod = z.infer<
  typeof PlanReceiptPaymentMethodSchema
>

export const PlanReceiptSchema = z.object({
  amountCents: z.number().int(),
  paidAt: z.string().datetime(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  paymentMethod: PlanReceiptPaymentMethodSchema.nullable(),
  receiptUrl: z.string().nullable(),
  planEndsAt: z.string().datetime().nullable(),
})
export type PlanReceipt = z.infer<typeof PlanReceiptSchema>
