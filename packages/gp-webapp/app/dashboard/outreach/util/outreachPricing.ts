// Integer tenth-cents rounded to the cent, so a long list reads as the amount
// checkout will charge rather than a cent under it: float math on
// 16,449 x 0.035 lands short of what gp-api's own pricing utils produce.
//
// Shared because two surfaces quote the same send — the CRM channel picker and
// the priority chat's outreach card — and a quote that disagrees with checkout
// on one of them is worse than no quote.
export const outreachCostCents = (
  reach: number,
  pricePerPerson: number,
): number => Math.round((reach * Math.round(pricePerPerson * 1000)) / 10)

export const formatOutreachCost = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
