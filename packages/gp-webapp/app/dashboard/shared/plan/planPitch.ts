import { PLAN_PRICING } from '@goodparty_org/contracts'

export type PitchedPlan = 'pro' | 'team'

export interface PlanPitch {
  // False while flags load, so a surface can wait rather than flash the
  // legacy price.
  ready: boolean
  // Flag state: false keeps every surface on its existing copy.
  enabled: boolean
  plan: PitchedPlan
  name: string
  price: string
  credit: string
}

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
  ready: boolean,
  enabled: boolean,
  recommendTeam: boolean,
): PlanPitch => {
  const plan: PitchedPlan = recommendTeam ? 'team' : 'pro'
  return {
    ready,
    enabled,
    plan,
    name: plan === 'team' ? 'Team' : 'Pro',
    price: formatPlanCents(
      plan === 'team' ? PLAN_PRICING.teamCents : PLAN_PRICING.proCents,
    ),
    credit: formatPlanCents(PLAN_PRICING.includedCreditCents),
  }
}
