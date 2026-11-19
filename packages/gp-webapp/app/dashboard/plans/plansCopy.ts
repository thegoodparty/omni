import { PLAN_PRICING } from '@goodparty_org/contracts'
import { formatPlanCents } from '../shared/plan/planPitch'
import { MEMBERSHIP_COPY } from '../shared/membership/membershipCopy'

export type PlanKey = 'free' | 'pro' | 'team'

export interface PlanCardCopy {
  plan: PlanKey
  name: string
  price: string
  caption: string
  features: string[]
}

const PRO_FEATURES = [
  `${formatPlanCents(PLAN_PRICING.includedCreditCents)} in outreach credit`,
  ...MEMBERSHIP_COPY.pitch.tiles.map((tile) => tile.title),
]

export const PLANS_COPY = {
  title: 'Plans',
  back: 'Back to dashboard',
  currentBadge: 'Current plan',
  currentCta: 'Your current plan',
} as const

export const PLAN_CARDS: PlanCardCopy[] = [
  {
    plan: 'free',
    name: 'Free',
    price: formatPlanCents(0),
    caption: 'Start with your campaign dashboard.',
    features: ['Campaign dashboard and assistants'],
  },
  {
    plan: 'pro',
    name: 'Pro',
    price: formatPlanCents(PLAN_PRICING.proCents),
    caption: 'One payment for your campaign.',
    features: PRO_FEATURES,
  },
  {
    plan: 'team',
    name: 'Team',
    price: formatPlanCents(PLAN_PRICING.teamCents),
    caption: 'One payment for your campaign.',
    features: ['Everything in Pro', 'Invite your team'],
  },
]
