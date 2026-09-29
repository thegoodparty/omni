import { z } from 'zod'

// Receipt for the Pro subscription's most recent paid invoice, read live from
// Stripe off the subscription the completion webhook stores on the campaign.
// `amount` is in DOLLARS, the same convention as OutreachReceipt. `receiptUrl`
// is the invoice PDF when Stripe has one, else the charge's hosted receipt.
// The endpoint 404s a campaign with no subscription or no paid invoice yet.
export const ProReceiptSchema = z.object({
  amount: z.number(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  paidAt: z.string().nullable(),
})
export type ProReceipt = z.infer<typeof ProReceiptSchema>
