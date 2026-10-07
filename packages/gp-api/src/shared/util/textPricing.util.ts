import { PRICE_PER_TEXT_TENTH_CENTS } from '@goodparty_org/contracts'

export function calcTextAmountInCents(textCount: number): number {
  const totalTenthCents = textCount * PRICE_PER_TEXT_TENTH_CENTS
  return Math.floor((totalTenthCents + 5) / 10)
}
