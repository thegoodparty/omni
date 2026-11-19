'use client'

import Link from 'next/link'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { WIN_PER_CAMPAIGN_PRICING_FLAG_KEY } from '@shared/experiments/winPerCampaignPricingFlag'
import DashboardLayout from '../shared/DashboardLayout'
import { usePlan } from '../shared/membership/deriveMembershipState'
import { PlanCards } from './PlanCards'
import { PlansTable } from './PlansTable'
import { planCheckoutHref } from './planCheckoutHref'
import { planColumnsFor, PLANS_COPY, planRank, type PlanKey } from './plansCopy'

interface PlansPageProps {
  highlightTeam: boolean
}

const PlansPage = ({ highlightTeam }: PlansPageProps): React.JSX.Element => {
  const { plan: currentPlan } = usePlan()
  const hrefFor = (plan: PlanKey): string | null => {
    const column = planColumnsFor(currentPlan).find((c) => c.plan === plan)
    if (plan === 'free' || !column?.cta) return null
    return planRank(plan) > planRank(currentPlan)
      ? planCheckoutHref(plan, column.cta)
      : null
  }

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
          <p className="text-sm">{PLANS_COPY.intro}</p>
          <div className="hidden md:block">
            <PlansTable currentPlan={currentPlan} hrefFor={hrefFor} />
          </div>
          <div className="md:hidden">
            <PlanCards
              currentPlan={currentPlan}
              highlightTeam={highlightTeam}
              hrefFor={hrefFor}
            />
          </div>
        </div>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default PlansPage
