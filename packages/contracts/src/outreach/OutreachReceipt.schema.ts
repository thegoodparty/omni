import { z } from 'zod'

// Receipt for a paid SMS campaign, read live from Stripe off the stored
// checkout session. `amount` is in DOLLARS — the same convention as the
// checkout-session endpoint (stripe divides amount_total by 100 server-side).
// The card/receipt fields are nullable because Stripe only guarantees them on
// card charges; the endpoint 404s rows with no recorded session (free-texts).
export const OutreachReceiptSchema = z.object({
  amount: z.number(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  paidAt: z.string().nullable(),
})
export type OutreachReceipt = z.infer<typeof OutreachReceiptSchema>
