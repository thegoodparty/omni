'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@styleguide'
import H2 from '@shared/typography/H2'
import Body2 from '@shared/typography/Body2'
import {
  CAMPAIGN_QUERY_KEY,
  fetchCampaign,
} from '@shared/hooks/CampaignProvider'
import { Spinner } from '@styleguide'
import { PRO_COMPLIANCE_SUPPORT_EMAIL as SUPPORT_EMAIL } from '@shared/utils/supportContact'
import { ELIGIBILITY_QUERY_KEY } from '@shared/organization-picker'
import { clientRequest } from 'gpApi/typed-request'
import type { Eligibility } from 'gpApi/api-endpoints'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'
import { useWinPerCampaignPricingFlag } from 'app/shared/experiments/winPerCampaignPricingFlag'
import { parseProUpgradeAttribution } from '../proUpgradeAttribution'
import { carryQueryString } from '../proUpgradePlanParams'
import { deriveProUpgradeStep, proUpgradeStepPath } from '../proUpgradeStep'
import { useProUpgradeCarry } from './proUpgradeCarryContext'

// Wizard index: derives the resume step from canonical state and redirects to
// it. There is no server-side wizard session (tech doc v2), so every entry
// re-derives.
const ProUpgradeEntry = (): React.JSX.Element | null => {
  const router = useRouter()
  const searchParams = useSearchParams()
  // The redirect effect re-runs whenever a query refetches, and the funnel
  // needs one start per entry.
  const flowStartedRef = useRef(false)

  // Observe the shared campaign query (same key as CampaignProvider, deduped)
  // so step derivation waits for it. Reading campaign from context instead
  // would let `ready` flip true while the campaign is still loading (when the
  // SSR fetch returned null on token/API failure, so initialData is undefined),
  // mis-deriving a returning candidate and producing a double-redirect.
  const {
    data: campaign,
    isPending: campaignPending,
    isError: campaignError,
    refetch: refetchCampaign,
  } = useQuery({
    queryKey: CAMPAIGN_QUERY_KEY,
    queryFn: fetchCampaign,
  })
  // Server-derived eligibility (the same isActiveCampaign predicate the
  // checkout-session guard runs), so an inactive campaign is caught here with
  // an explanation instead of a generic 400 after five steps of forms
  // (ENG-10892). Not re-derived client-side to avoid predicate drift.
  const {
    data: eligibility,
    isPending: eligibilityPending,
    isError: eligibilityError,
    refetch: refetchEligibility,
  } = useQuery<Eligibility>({
    queryKey: ELIGIBILITY_QUERY_KEY,
    queryFn: () =>
      clientRequest('GET /v1/eligibility', {}).then((res) => res.data),
  })

  // The flag only decides whether a Pro holder asking for Team goes straight
  // to payment, so it is read without counting an exposure.
  const { ready: flagReady, enabled: planPricing } =
    useWinPerCampaignPricingFlag(false)
  const carry = useProUpgradeCarry()
  const { heldPlan, onSubscription } = usePlan()
  const upgradeToTeam =
    planPricing &&
    carry.plan === 'team' &&
    !onSubscription &&
    heldPlan !== 'team' &&
    (heldPlan === 'pro' || Boolean(campaign?.isPro))

  // Only a Team request needs the flag settled to pick its step; waiting on it
  // for everyone would hold every other entry behind the flag fetch.
  const ready =
    !campaignPending &&
    !eligibilityPending &&
    (flagReady || carry.plan !== 'team')
  const hasError = campaignError || eligibilityError
  // Already-Pro users have nothing left to buy — let derivation route them to
  // the post-payment SUCCESS surface instead of a purchase-blocked screen.
  const purchaseBlocked =
    ready && !hasError && !campaign?.isPro && !eligibility?.hasActiveCampaign

  useEffect(() => {
    // Don't derive a step from partial state: a failed fetch leaves data
    // undefined, which would mis-derive a returning Pro candidate as new.
    if (!ready || hasError || purchaseBlocked) return

    const step = deriveProUpgradeStep({
      isPro: Boolean(campaign?.isPro),
      upgradeToTeam,
    })

    // An already-Pro candidate is routed to success, not into a purchase;
    // the exception is a Pro holder buying Team.
    if ((!campaign?.isPro || upgradeToTeam) && !flowStartedRef.current) {
      flowStartedRef.current = true
      trackEvent(
        EVENTS.ProUpgrade.Compliance.FlowStarted,
        parseProUpgradeAttribution(searchParams),
      )
    }

    router.replace(`${proUpgradeStepPath(step)}${carryQueryString(carry)}`)
  }, [
    ready,
    hasError,
    purchaseBlocked,
    campaign,
    router,
    searchParams,
    upgradeToTeam,
    carry,
  ])

  // Spinner only while the canonical-state queries are pending.
  if (!ready)
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    )

  // A fetch failed: show a recoverable error instead of mis-routing to the
  // intro. Refetching clears the error and re-runs the redirect effect.
  if (hasError) {
    return (
      <div className="text-center">
        <H2 className="mb-2">Something went wrong</H2>
        <Body2 className="mb-6 text-base-muted-foreground">
          We couldn&apos;t load your upgrade details. Please try again.
        </Body2>
        <Button
          onClick={() => {
            void refetchCampaign()
            void refetchEligibility()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (purchaseBlocked) {
    return (
      <div className="text-center">
        <H2 className="mb-2">Pro requires an active campaign</H2>
        <Body2 className="mb-6 text-base-muted-foreground">
          Our records show your campaign isn&apos;t active right now — usually
          because its election date has passed or an election result was
          recorded. If you&apos;re running in an upcoming election, contact us
          and we&apos;ll get your campaign updated so you can upgrade.
        </Body2>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Help upgrading to Pro')}`}
            >
              Contact support
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    )
  }

  // Ready, no error: the redirect is already scheduled in the effect above, so
  // return null — a silently-failed router.replace can't strand the user on a
  // permanent spinner.
  return null
}

export default ProUpgradeEntry
