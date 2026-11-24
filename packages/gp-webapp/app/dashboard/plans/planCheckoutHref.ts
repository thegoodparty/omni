import { proUpgradeHref } from '../pro-upgrade/proUpgradeAttribution'

export type PaidPlanKey = 'pro' | 'team'

// The wizard entry reads `plan` to choose between Pro, Team and the Pro to
// Team upgrade, so one URL serves every paid CTA.
// `backTo` is the page the CTA sits on, so Back off the first step returns
// there instead of the dashboard.
export const planCheckoutHref = (
  plan: PaidPlanKey,
  cta: string,
  backTo?: string,
): string =>
  proUpgradeHref(
    { source: 'navigation', channel: 'generic', cta },
    { plan, backTo },
  )
