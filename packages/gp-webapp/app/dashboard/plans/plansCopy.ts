import {
  PLAN_PRICING,
  PRICE_PER_TEXT_TENTH_CENTS,
} from '@goodparty_org/contracts'
import type { ComponentType } from 'react'
import {
  BookOpenIcon,
  DoorOpenIcon,
  ListChecksIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  UsersIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'
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

// A campaign holding a Pro plan pays only the difference to move to Team (the
// held plan, as gp-api prices it, not the legacy-aware access plan). A monthly
// subscriber can't buy Team, so their Team column keeps the full price.
export const planColumnsFor = (
  heldPlan: PlanKey,
  onSubscription = false,
): PlanColumn[] =>
  PLAN_COLUMNS.map((column) =>
    column.plan === 'team' && heldPlan === 'pro' && !onSubscription
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
  icon: ComponentType<{ className?: string }>
  // The first plan that includes it; Team includes everything Pro does.
  from: PlanKey
  // Shown beside the check on the plans that include it.
  offer?: string
}

// How many texts the included credit buys, from the same constants that price
// a text. Cents times ten is tenth-cents, the unit PRICE_PER_TEXT is stored in.
export const INCLUDED_CREDIT_TEXTS = Math.round(
  (PLAN_PRICING.includedCreditCents * 10) / PRICE_PER_TEXT_TENTH_CENTS,
)

export const PLAN_FEATURES: PlanFeature[] = [
  {
    title: 'Campaign plan and manager',
    icon: ListChecksIcon,
    caption: 'Get a step-by-step plan for your race',
    from: 'free',
  },
  {
    title: 'Your story and public profile',
    icon: BookOpenIcon,
    caption: 'Tell voters who you are',
    from: 'free',
  },
  {
    title: 'Voter data and lists',
    icon: UsersRoundIcon,
    caption: 'Find voters and build target lists',
    from: 'pro',
  },
  {
    title: 'Voter outreach tools',
    icon: MessageSquareIcon,
    caption: 'Texts, robocalls, and more',
    from: 'pro',
    offer: `${formatPlanCents(PLAN_PRICING.includedCreditCents)} credit`,
  },
  {
    title: 'Campaign verification',
    icon: ShieldCheckIcon,
    caption: 'Get registered to text voters, a $120 value',
    from: 'pro',
  },
  {
    title: 'Door knocking and phone banking',
    icon: DoorOpenIcon,
    caption: 'Routes and call lists for volunteers',
    from: 'pro',
  },
  {
    title: 'Logins for your team',
    icon: UsersIcon,
    caption: 'Add a campaign manager and volunteers',
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
  heading: 'Unlock voter data and outreach',
  subtitle: 'Pay once for your plan, good for your whole race.',
  recommend: (plan: string) => `We recommend ${plan} for a race your size.`,
  bestForRace: 'Best for your race',
  creditIncluded: `${formatPlanCents(PLAN_PRICING.includedCreditCents)} credit included`,
  creditWorth: `(worth ${INCLUDED_CREDIT_TEXTS.toLocaleString('en-US')} texts)`,
  everythingInPlus: (plan: string) => `Everything in ${plan}, plus`,
  everythingInExcept: (plan: string) => `Everything in ${plan}, except`,
  compare: 'Compare plans',
  bonus: 'Bonus',
  currentBadge: 'Current plan',
  subscriptionNote:
    "You're on Pro at $10 a month. Team isn't available on a monthly plan.",
  included: 'Included',
  notIncluded: 'Not included',
} as const
