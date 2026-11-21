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
  const { plan: currentPlan, onSubscription, recommendTeam } = usePlan()
  const highlighted: PlanKey =
    highlightTeam || (currentPlan === 'free' && recommendTeam) ? 'team' : 'pro'
  const offerFor = (plan: PlanKey): { href: string | null } | null => {
    const column = planColumnsFor(currentPlan, onSubscription).find(
      (c) => c.plan === plan,
    )
    if (plan === 'free' || !column?.cta) return null
    if (planRank(plan) <= planRank(currentPlan)) return null
    if (onSubscription) return { href: null }
    return { href: planCheckoutHref(plan, column.cta) }
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
            <span className="text-base font-semibold">{PLANS_COPY.title}</span>
          </div>
          <div className="flex flex-col gap-1.5 md:items-center md:text-center">
            <h1 className="text-xl font-semibold md:text-2xl">
              {PLANS_COPY.heading}
            </h1>
            <p className="text-sm text-muted-foreground md:text-base">
              {onSubscription
                ? PLANS_COPY.subscriptionNote
                : PLANS_COPY.subtitle}
              {!onSubscription && (
                <span className="md:hidden"> {PLANS_COPY.upgradeAnytime}.</span>
              )}
            </p>
          </div>
          <div className="hidden md:block">
            <PlansTable
              currentPlan={currentPlan}
              onSubscription={onSubscription}
              highlighted={highlighted}
              offerFor={offerFor}
            />
          </div>
          <div className="md:hidden">
            <PlanCards
              currentPlan={currentPlan}
              onSubscription={onSubscription}
              highlighted={highlighted}
              offerFor={offerFor}
            />
          </div>
        </div>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default PlansPage
