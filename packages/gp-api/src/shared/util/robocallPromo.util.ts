import type Stripe from 'stripe'

// Stripe refuses a PaymentIntent under 50 cents, so a discount that leaves less
// than this has nothing to hold: the run is treated as fully covered and the
// sub-minimum remainder is forgiven rather than rejected.
export const ROBOCALL_MIN_HOLD_CENTS = 50

// The cents a reward coupon takes off an estimate. CAS mints amount-off codes
// (a fixed number of calls at a fixed rate), and the discount covers the WHOLE
// total, calls plus the number fee (product decision 2026-09-23). A percent-off
// coupon is honored too. Capped at the estimate: a code worth more than the run
// forfeits the remainder, the same way the free-texts offer does.
export const robocallDiscountInCents = (
  coupon: Pick<Stripe.Coupon, 'amount_off' | 'percent_off' | 'currency'>,
  estimateInCents: number,
): number => {
  if (coupon.amount_off != null && (coupon.currency ?? 'usd') === 'usd') {
    return Math.min(coupon.amount_off, estimateInCents)
  }
  if (coupon.percent_off != null) {
    return Math.min(
      Math.floor((estimateInCents * coupon.percent_off) / 100),
      estimateInCents,
    )
  }
  return 0
}

export type RobocallPromoState = {
  promoCode: string | null
  promoDiscountInCents: number
  amountDueInCents: number
  coversTotal: boolean
}

// The pay step's view of a draft's promo: how much the remembered code takes
// off the estimate and what, if anything, is left to hold. Derived here (not in
// the client) so the one place that knows the sub-minimum rule is the server.
export const robocallPromoState = (
  promo: { promoCode: string | null; promoDiscountInCents: number | null },
  estimateInCents: number,
): RobocallPromoState => {
  const discount = Math.min(promo.promoDiscountInCents ?? 0, estimateInCents)
  const remainder = estimateInCents - discount
  const coversTotal = discount > 0 && remainder < ROBOCALL_MIN_HOLD_CENTS
  return {
    promoCode: promo.promoCode,
    promoDiscountInCents: coversTotal ? estimateInCents : discount,
    amountDueInCents: coversTotal ? 0 : remainder,
    coversTotal,
  }
}
