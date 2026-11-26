import { PLAN_PRICING } from '@goodparty_org/contracts'
import {
  PLANS_BACK_TO_PARAM,
  parsePlansBackTo,
} from 'app/dashboard/pro-upgrade/proUpgradePlanParams'

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
  ready: boolean,
  enabled: boolean,
  recommendTeam: boolean,
  // The page the pitch is on, so Back on the plans page returns to it. Pages
  // the plans page does not return to are dropped.
  backTo?: string | null,
): PlanPitch => {
  const plan: PitchedPlan = recommendTeam ? 'team' : 'pro'
  const params = new URLSearchParams()
  if (recommendTeam) params.set(ALL_PLANS_HIGHLIGHT_PARAM, 'team')
  const origin = parsePlansBackTo(backTo)
  if (origin) params.set(PLANS_BACK_TO_PARAM, origin)
  const query = params.toString()
  return {
    ready,
    enabled,
    plan,
    name: plan === 'team' ? 'Team' : 'Pro',
    price: formatPlanCents(
      plan === 'team' ? PLAN_PRICING.teamCents : PLAN_PRICING.proCents,
    ),
    credit: formatPlanCents(PLAN_PRICING.includedCreditCents),
    allPlansHref: query ? `${ALL_PLANS_PATH}?${query}` : ALL_PLANS_PATH,
  }
}
