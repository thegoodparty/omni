import { z } from 'zod'

// Receipt for the campaign's latest paid plan purchase. `amountCents` is what
// was charged after any promo code. The card fields and `receiptUrl` are null
// when no charge backs the purchase (a promo code covered it in full).
export const PlanReceiptSchema = z.object({
  amountCents: z.number().int(),
  paidAt: z.string().datetime(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  planEndsAt: z.string().datetime().nullable(),
})
export type PlanReceipt = z.infer<typeof PlanReceiptSchema>
