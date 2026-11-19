'use client'

import Link from 'next/link'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { WIN_PER_CAMPAIGN_PRICING_FLAG_KEY } from '@shared/experiments/winPerCampaignPricingFlag'
import DashboardLayout from '../shared/DashboardLayout'
import { usePlan } from '../shared/membership/deriveMembershipState'
import { PlanCard } from './PlanCard'
import { planCheckoutHref, type PaidPlanKey } from './planCheckoutHref'
import { PLAN_CARDS, PLANS_COPY, type PlanKey } from './plansCopy'

const PLAN_RANK: Record<PlanKey, number> = { free: 0, pro: 1, team: 2 }

interface PlansPageProps {
  highlightTeam: boolean
}

const PlansPage = ({ highlightTeam }: PlansPageProps): React.JSX.Element => {
  const { plan: currentPlan } = usePlan()

  return (
    <FeatureFlagGuard
      flagKey={WIN_PER_CAMPAIGN_PRICING_FLAG_KEY}
      trackExposure={false}
    >
      <DashboardLayout pathname="/dashboard/plans" hideMenu>
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              aria-label={PLANS_COPY.back}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeftIcon className="size-5" aria-hidden />
            </Link>
            <h1 className="text-base font-semibold">{PLANS_COPY.title}</h1>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLAN_CARDS.map((card) => {
              const ctaPlan: PaidPlanKey | null =
                card.plan !== 'free' &&
                PLAN_RANK[card.plan] > PLAN_RANK[currentPlan]
                  ? card.plan
                  : null
              const label =
                currentPlan === 'pro' && card.plan === 'team'
                  ? 'Upgrade to Team'
                  : `Join ${card.name}`
              return (
                <PlanCard
                  key={card.plan}
                  card={card}
                  isCurrent={card.plan === currentPlan}
                  cta={
                    ctaPlan
                      ? { label, href: planCheckoutHref(ctaPlan, label) }
                      : null
                  }
                  className={cn(
                    highlightTeam &&
                      card.plan === 'team' &&
                      '-order-1 md:order-none',
                  )}
                />
              )
            })}
          </div>
        </div>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default PlansPage
