import {
  MAX_LIST_SAMPLE_SIZE,
  PRICE_PER_TEXT_TENTH_CENTS,
  recommendedSampleSize,
} from '@goodparty_org/contracts'

export type GatherOption = 'min' | 'all' | 'budget'

interface GatherSizeInput {
  // Null when the district count is not available; the count-based options
  // then resolve to nothing and the budget is the only way to size it.
  totalConstituents: number | null
  sent: number
  responses: number
  budgetDollars: number
}

export const remainingConstituents = (
  totalConstituents: number | null,
  sent: number,
): number | null =>
  totalConstituents === null ? null : Math.max(0, totalConstituents - sent)

// The size asked of gp-api, which clamps it again to who is still reachable.
export const gatherSize = (
  option: GatherOption,
  { totalConstituents, sent, responses, budgetDollars }: GatherSizeInput,
): number => {
  const remaining = remainingConstituents(totalConstituents, sent)
  if (option === 'budget') {
    const tenthsOfCents = Math.round(budgetDollars * 1000)
    return Math.min(
      Math.floor(tenthsOfCents / PRICE_PER_TEXT_TENTH_CENTS),
      MAX_LIST_SAMPLE_SIZE,
    )
  }
  if (remaining === null) return 0
  if (option === 'all') return Math.min(remaining, MAX_LIST_SAMPLE_SIZE)
  return recommendedSampleSize({
    audience: remaining,
    repliesAlready: responses,
  })
}
