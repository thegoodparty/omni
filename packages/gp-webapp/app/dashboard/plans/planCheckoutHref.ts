import { proUpgradeHref } from '../pro-upgrade/proUpgradeAttribution'

export type PaidPlanKey = 'pro' | 'team'

// The wizard entry reads `plan` to choose between Pro, Team and the Pro to
// Team upgrade, so one URL serves every paid CTA.
export const planCheckoutHref = (plan: PaidPlanKey, cta: string): string =>
  `${proUpgradeHref({ source: 'navigation', channel: 'generic', cta })}&plan=${plan}`
