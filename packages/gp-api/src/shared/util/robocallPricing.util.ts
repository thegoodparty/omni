// The per-contact robocall price, server-side. Mirrors textPricing.util.ts and
// the webapp's OUTREACH_OPTIONS robocall `cost: 0.045` (the only prior source,
// client-side) — 45 tenth-cents so the same round-half-up math as text applies.
export const PRICE_PER_ROBOCALL_TENTH_CENTS = 45

// Flat fee for renting the outgoing caller-ID number, charged once per run on
// top of the per-call cost. It is part of every authorized total but is RELEASED
// (the hold voided), not collected, for a run that connected zero calls — the
// fee is charged only when at least one call actually connects. See
// `calcRobocallTotalInCents`.
export const ROBOCALL_NUMBER_FEE_CENTS = 200

// The per-call cost alone (no number fee). Used only where the calls portion is
// needed on its own; the authorized/captured/charged money figures all use the
// total below.
export function calcRobocallAmountInCents(contactCount: number): number {
  const totalTenthCents = contactCount * PRICE_PER_ROBOCALL_TENTH_CENTS
  return Math.floor((totalTenthCents + 5) / 10)
}

// The full amount to authorize, capture, and charge for a run: the per-call
// cost plus the flat number-rental fee. This is the single money figure the
// hold, capture, and fresh-charge all price off. The fee is authorized up front,
// but a run that connects zero calls releases the whole hold (fee included) — the
// fee is collected only when at least one call connects.
export function calcRobocallTotalInCents(contactCount: number): number {
  return calcRobocallAmountInCents(contactCount) + ROBOCALL_NUMBER_FEE_CENTS
}
