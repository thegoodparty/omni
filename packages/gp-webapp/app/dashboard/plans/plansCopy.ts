import { PLAN_PRICING } from '@goodparty_org/contracts'
import { formatPlanCents } from '../shared/plan/planPitch'

export type PlanKey = 'free' | 'pro' | 'team'

export interface PlanColumn {
  plan: PlanKey
  name: string
  caption: string
  price: string
  // Null on Free: nothing to buy.
  cta: string | null
}

export const PLAN_COLUMNS: PlanColumn[] = [
  {
    plan: 'free',
    name: 'Free',
    caption: 'To get started',
    price: formatPlanCents(0),
    cta: null,
  },
  {
    plan: 'pro',
    name: 'Pro',
    caption: 'For you on your own',
    price: formatPlanCents(PLAN_PRICING.proCents),
    cta: `Join Pro for ${formatPlanCents(PLAN_PRICING.proCents)}`,
  },
  {
    plan: 'team',
    name: 'Team',
    caption: 'For you and your team',
    price: formatPlanCents(PLAN_PRICING.teamCents),
    cta: `Join Team for ${formatPlanCents(PLAN_PRICING.teamCents)}`,
  },
]

// A Pro campaign pays only the difference to move to Team.
export const planColumnsFor = (currentPlan: PlanKey): PlanColumn[] =>
  PLAN_COLUMNS.map((column) =>
    column.plan === 'team' && currentPlan === 'pro'
      ? {
          ...column,
          cta: `Join Team for ${formatPlanCents(
            PLAN_PRICING.teamCents - PLAN_PRICING.proCents,
          )}`,
        }
      : column,
  )

export interface PlanFeature {
  title: string
  caption: string
  // The first plan that includes it; Team includes everything Pro does.
  from: PlanKey
  // Shown beside the check on the plans that include it.
  offer?: string
}

export const PLAN_FEATURES: PlanFeature[] = [
  {
    title: 'Campaign plan and agent',
    caption: 'Your step-by-step plan, with an agent to help',
    from: 'free',
  },
  {
    title: 'Your story and public profile',
    caption: "Tell voters who you are and why you're running",
    from: 'free',
  },
  {
    title: 'Voter data and lists',
    caption: 'Find the voters who matter and build targeted lists',
    from: 'pro',
  },
  {
    title: 'Texts and robocalls',
    caption: 'Introduce yourself and share your message',
    from: 'pro',
    offer: `${formatPlanCents(PLAN_PRICING.includedCreditCents)} credit`,
  },
  {
    title: 'Door knocking and phone banking',
    caption: 'Routes and call lists for you and your volunteers',
    from: 'pro',
  },
  {
    title: 'Campaign verification',
    caption: 'We register your campaign with the carriers',
    from: 'pro',
  },
  {
    title: 'Logins for your team',
    caption: 'Your campaign manager and volunteers get their own',
    from: 'team',
  },
]

const PLAN_RANK: Record<PlanKey, number> = { free: 0, pro: 1, team: 2 }

export const planRank = (plan: PlanKey): number => PLAN_RANK[plan]

export const planIncludes = (plan: PlanKey, feature: PlanFeature): boolean =>
  PLAN_RANK[plan] >= PLAN_RANK[feature.from]

export const PLANS_COPY = {
  title: 'Plans',
  back: 'Back to dashboard',
  intro:
    'Pay once, good for your whole campaign. Start with Pro and move to Team later by paying the difference.',
  compare: 'Compare plans',
  currentBadge: 'Current plan',
  included: 'Included',
  notIncluded: 'Not included',
} as const
