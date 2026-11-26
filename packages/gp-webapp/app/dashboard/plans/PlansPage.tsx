'use client'

import Link from 'next/link'
import { Button } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { WIN_PER_CAMPAIGN_PRICING_FLAG_KEY } from '@shared/experiments/winPerCampaignPricingFlag'
import DashboardLayout from '../shared/DashboardLayout'
import { usePlan } from '../shared/membership/deriveMembershipState'
import { PlanCards } from './PlanCards'
import { PlansTable } from './PlansTable'
import { plansHrefWithBackTo } from '../pro-upgrade/proUpgradePlanParams'
import { planCheckoutHref } from './planCheckoutHref'
import { planColumnsFor, PLANS_COPY, planRank, type PlanKey } from './plansCopy'

interface PlansPageProps {
  highlightTeam: boolean
  // The page that opened Plans, already checked against the allowed list.
  backTo: string | null
}

const PlansPage = ({
  highlightTeam,
  backTo,
}: PlansPageProps): React.JSX.Element => {
  const {
    plan: currentPlan,
    heldPlan,
    onSubscription,
    recommendTeam,
  } = usePlan()
  const highlighted: PlanKey =
    highlightTeam || (currentPlan === 'free' && recommendTeam) ? 'team' : 'pro'
  // Only a Free campaign is told which plan fits its race.
  const recommended: PlanKey | null =
    currentPlan === 'free' ? highlighted : null
  const offerFor = (plan: PlanKey): { href: string | null } | null => {
    const column = planColumnsFor(heldPlan, onSubscription).find(
      (c) => c.plan === plan,
    )
    if (plan === 'free' || !column?.cta) return null
    if (planRank(plan) <= planRank(currentPlan)) return null
    if (onSubscription) return { href: null }
    return {
      // Checkout's Back returns here, and this page's Back still reaches
      // where the candidate started.
      href: planCheckoutHref(
        plan,
        `Join ${column.name}`,
        plansHrefWithBackTo(backTo),
      ),
    }
  }

  return (
    <FeatureFlagGuard
      flagKey={WIN_PER_CAMPAIGN_PRICING_FLAG_KEY}
      trackExposure={false}
    >
      <DashboardLayout pathname="/dashboard/plans" hideMenu hideChatDock>
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="small">
              <Link href={backTo ?? '/dashboard'}>
                <ArrowLeftIcon className="size-4" aria-hidden />
                {PLANS_COPY.back}
              </Link>
            </Button>
          </div>
          <div className="flex flex-col gap-1.5 md:items-center md:text-center">
            <h1 className="text-xl font-semibold md:text-2xl">
              {PLANS_COPY.heading}
            </h1>
            <p className="text-sm text-muted-foreground md:text-base">
              {onSubscription
                ? PLANS_COPY.subscriptionNote
                : PLANS_COPY.subtitle}
            </p>
          </div>
          <div className="hidden md:block">
            <PlansTable
              currentPlan={currentPlan}
              heldPlan={heldPlan}
              onSubscription={onSubscription}
              highlighted={highlighted}
              recommended={recommended}
              offerFor={offerFor}
            />
          </div>
          <div className="md:hidden">
            <PlanCards
              currentPlan={currentPlan}
              heldPlan={heldPlan}
              onSubscription={onSubscription}
              highlighted={highlighted}
              recommended={recommended}
              offerFor={offerFor}
            />
          </div>
        </div>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default PlansPage
