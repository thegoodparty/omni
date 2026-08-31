// The per-contact robocall price, server-side. Mirrors textPricing.util.ts and
// the webapp's OUTREACH_OPTIONS robocall `cost: 0.045` (the only prior source,
// client-side) — 45 tenth-cents so the same round-half-up math as text applies.
export const PRICE_PER_ROBOCALL_TENTH_CENTS = 45

// Flat fee for renting the outgoing caller-ID number, charged once per run on
// top of the per-call cost. It is part of every authorized total and is always
// captured for a dialed run — the number was really rented — so it does NOT
// scale with the connected-call count. See `calcRobocallTotalInCents`.
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
// hold, capture, and fresh-charge all price off, so the fee is authorized up
// front and always collected for a dialed run (even one that connects zero
// calls — the rented number is a sunk cost).
export function calcRobocallTotalInCents(contactCount: number): number {
  return calcRobocallAmountInCents(contactCount) + ROBOCALL_NUMBER_FEE_CENTS
}
