// The per-contact robocall price, server-side. Mirrors textPricing.util.ts and
// the webapp's OUTREACH_OPTIONS robocall `cost: 0.045` (the only prior source,
// client-side) — 45 tenth-cents so the same round-half-up math as text applies.
export const PRICE_PER_ROBOCALL_TENTH_CENTS = 45

export function calcRobocallAmountInCents(contactCount: number): number {
  const totalTenthCents = contactCount * PRICE_PER_ROBOCALL_TENTH_CENTS
  return Math.floor((totalTenthCents + 5) / 10)
}
