import { PLAN_PRICING } from '@goodparty_org/contracts'

export type PitchedPlan = 'pro' | 'team'

export interface PlanPitch {
  // Flag state: false keeps every surface on its existing copy.
  enabled: boolean
  plan: PitchedPlan
  name: string
  price: string
  credit: string
  allPlansHref: string
}

export const ALL_PLANS_PATH = '/dashboard/plans'
// ?highlight=team lands the comparison page on the Team column.
export const ALL_PLANS_HIGHLIGHT_PARAM = 'highlight'
export const SEE_ALL_PLANS_LABEL = 'See all plans'

export const formatPlanCents = (cents: number): string => {
  const whole = cents % 100 === 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100)
}

export const buildPlanPitch = (
  enabled: boolean,
  recommendTeam: boolean,
): PlanPitch => {
  const plan: PitchedPlan = recommendTeam ? 'team' : 'pro'
  return {
    enabled,
    plan,
    name: plan === 'team' ? 'Team' : 'Pro',
    price: formatPlanCents(
      plan === 'team' ? PLAN_PRICING.teamCents : PLAN_PRICING.proCents,
    ),
    credit: formatPlanCents(PLAN_PRICING.includedCreditCents),
    allPlansHref:
      plan === 'team'
        ? `${ALL_PLANS_PATH}?${ALL_PLANS_HIGHLIGHT_PARAM}=team`
        : ALL_PLANS_PATH,
  }
}
