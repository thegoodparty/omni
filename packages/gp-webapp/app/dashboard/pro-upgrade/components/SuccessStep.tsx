'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Button, ProBadge } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import {
  CAMPAIGN_QUERY_KEY,
  fetchCampaign,
} from '@shared/hooks/CampaignProvider'
import Confetti from 'app/dashboard/questions/components/Confetti'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useTakeoverActive } from 'app/dashboard/shared/takeover/TakeoverShell'
import WizardStepFooter from './WizardStepFooter'

// Post-payment, the candidate lands on the Campaign Manager dashboard, where
// `ProUpgrade3ComplianceCard` surfaces PIN entry (then review/approved/denied as
// the TCR record progresses) once `isPro` flips. The same card also lives on the
// profile page as a secondary location, but the dashboard is the primary
// post-upgrade destination (ENG-10361).
const DASHBOARD_PATH = '/dashboard'

// `isPro` flips server-side only when the Stripe `checkout.session.completed`
// webhook lands, which can lag the candidate arriving here. Poll the shared
// campaign query until it flips, then stop — or give up after the webhook
// window so a never-arriving flip doesn't poll forever.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

// Post-payment landing (Stripe embedded-checkout return_url + PaymentStep's
// on-confirm nav). Purely presentational: it never gates its content on the
// webhook-driven `isPro` flip, so it can't get stuck. It does refresh the shared
// campaign cache in the background so the dashboard's "Get Pro" banner — which
// reads the cached `isPro` — is already hidden when the candidate continues,
// instead of lingering until a manual page refresh.
const SuccessStep = (): React.JSX.Element => {
  const takeover = useTakeoverActive()
  const router = useRouter()
  const [pollExpired, setPollExpired] = useState(false)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessViewed)
    const timer = setTimeout(() => setPollExpired(true), POLL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  // Same key as CampaignProvider (deduped) so the refetch updates the campaign
  // every consumer reads. `staleTime: 0` fires the first refetch on mount (the
  // webhook may already have landed); the interval stops once Pro or expired.
  useQuery({
    queryKey: CAMPAIGN_QUERY_KEY,
    queryFn: fetchCampaign,
    staleTime: 0,
    refetchInterval: (query) =>
      !pollExpired && !query.state.data?.isPro ? POLL_INTERVAL_MS : false,
  })

  const handleContinue = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessContinue)
    router.push(DASHBOARD_PATH)
  }

  return (
    <>
      <Confetti />
      <div className="mx-auto flex max-w-[448px] flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-info-light">
          <ProBadge size="large" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] leading-[44px] font-semibold">
            Welcome to Pro!
          </h1>
          <Body2 className="text-base-muted-foreground">
            You can now access voter data, build lists and schedule robocalls!
            Your PIN will be sent to your email, phone or address within 7
            business days.
          </Body2>
        </div>

        {takeover ? (
          <WizardStepFooter
            centered
            primary={{ label: 'Continue', onClick: handleContinue }}
          />
        ) : (
          <Button size="large" className="w-full" onClick={handleContinue}>
            Continue
          </Button>
        )}
      </div>
    </>
  )
}

export default SuccessStep
