'use client'

import { useEffect } from 'react'
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
import { LoadingAnimation } from '@shared/utils/LoadingAnimation'
import {
  USER_WEBSITE_QUERY_KEY,
  getUserWebsite,
} from 'app/dashboard/website/util/website.util'
import {
  TCR_COMPLIANCE_QUERY_KEY,
  getTcrCompliance,
  getTcrComplianceStatusCompletions,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import { isCandidateProfileComplete } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import { checkEinSanity } from '@shared/inputs/EinSanityCheck'
import { PRO_GATE_COPY } from './takeoverProContent'
import { ELIGIBILITY_QUERY_KEY } from '@shared/organization-picker'
import { clientRequest } from 'gpApi/typed-request'
import type { Eligibility } from 'gpApi/api-endpoints'
import {
  deriveProUpgradeStep,
  filingStatusFromDetails,
  PRO_UPGRADE_STEP,
  proUpgradeStepPath,
} from '../proUpgradeStep'

const SUPPORT_EMAIL = 'campaignsuccess@goodparty.org'

// Wizard index: derives the resume step from canonical state and redirects to
// it. There is no server-side wizard session (tech doc v2), so every entry
// re-derives, landing a returning candidate on the first incomplete step.
const ProUpgradeEntry = (): React.JSX.Element | null => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const src = searchParams?.get('src') ?? null
  const channel = searchParams?.get('channel') ?? null

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
  const {
    data: website,
    isPending: websitePending,
    isError: websiteError,
    refetch: refetchWebsite,
  } = useQuery({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
  })
  const {
    data: tcrCompliance,
    isPending: tcrPending,
    isError: tcrError,
    refetch: refetchTcr,
  } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
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

  const ready =
    !campaignPending && !websitePending && !tcrPending && !eligibilityPending
  const hasError = campaignError || websiteError || tcrError || eligibilityError
  // Already-Pro users have nothing left to buy — let derivation route them to
  // the post-payment SUCCESS surface instead of a purchase-blocked screen.
  const purchaseBlocked =
    ready && !hasError && !campaign?.isPro && !eligibility?.hasActiveCampaign

  useEffect(() => {
    // Don't derive a step from partial state: a failed fetch leaves data
    // undefined, which would mis-derive a returning candidate back to the
    // value-prop intro as if they had zero progress.
    if (!ready || hasError || purchaseBlocked) return

    const { filingComplete, pinComplete } =
      getTcrComplianceStatusCompletions(tcrCompliance)

    const step = deriveProUpgradeStep({
      isPro: Boolean(campaign?.isPro),
      filingStatus: filingStatusFromDetails(campaign?.details?.hasFiledForRace),
      // Presence isn't enough: older surfaces persisted shape-valid
      // placeholder EINs, which would skip the EIN step only to fail
      // filing-details' sanity validation. A bad EIN routes back to the EIN
      // step where it can be fixed.
      hasEin: checkEinSanity(campaign?.details?.einNumber ?? '').valid,
      filingComplete,
      profileComplete: isCandidateProfileComplete(website),
      pinComplete,
    })

    // A gated-channel entry (?src=outreach&channel=<design channel>) always
    // opens on the channel pitch + gather overview (value-prop's takeover
    // screens), regardless of resume progress — the overview's Continue then
    // re-enters this index without the channel so derivation resumes at the
    // first incomplete step. Already-Pro still short-circuits to SUCCESS.
    if (
      channel &&
      PRO_GATE_COPY[channel] &&
      step !== PRO_UPGRADE_STEP.SUCCESS
    ) {
      router.replace(
        `${proUpgradeStepPath(PRO_UPGRADE_STEP.VALUE_PROP, src)}&channel=${encodeURIComponent(channel)}`,
      )
      return
    }

    router.replace(proUpgradeStepPath(step, src))
  }, [
    channel,
    src,
    ready,
    hasError,
    purchaseBlocked,
    campaign,
    website,
    tcrCompliance,
    router,
  ])

  // Spinner only while the canonical-state queries are pending.
  if (!ready) return <LoadingAnimation />

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
            void refetchWebsite()
            void refetchTcr()
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
