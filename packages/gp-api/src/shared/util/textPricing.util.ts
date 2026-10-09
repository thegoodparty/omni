import { PRICE_PER_TEXT_TENTH_CENTS } from '@goodparty_org/contracts'

export function calcTextAmountInCents(textCount: number): number {
  const totalTenthCents = textCount * PRICE_PER_TEXT_TENTH_CENTS
  return Math.floor((totalTenthCents + 5) / 10)
}

// The inverse of calcTextAmountInCents used by the Win SMS hold send cap: the
// largest text count whose undiscounted price does not exceed `cents`. Capping a
// send to this count guarantees calcTextAmountInCents(sent) <= cents, so a send
// can never cost more than the hold that authorized it (team decision 2: never
// oversend, never overcharge). Derived straight from calcTextAmountInCents:
// floor((n*P + 5)/10) <= C  <=>  n*P + 5 < 10*(C + 1)  <=>  n < (10C + 5)/P,
// so the largest integer n is ceil((10C + 5)/P) - 1. Clamped at 0 so a sub-floor
// amount yields a zero cap rather than a negative one.
export function maxTextsForAmountInCents(cents: number): number {
  const maxTexts = Math.ceil((10 * cents + 5) / PRICE_PER_TEXT_TENTH_CENTS) - 1
  return Math.max(0, maxTexts)
}
