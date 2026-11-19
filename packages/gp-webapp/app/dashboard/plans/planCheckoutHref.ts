import { proUpgradeHref } from '../pro-upgrade/proUpgradeAttribution'

export type PaidPlanKey = 'pro' | 'team'

// ENG-11691 reads `plan` from the checkout entry URL. Until then the entry is
// the existing Pro upgrade wizard, which ignores it.
export const planCheckoutHref = (plan: PaidPlanKey, cta: string): string =>
  `${proUpgradeHref({ source: 'navigation', channel: 'generic', cta })}&plan=${plan}`
