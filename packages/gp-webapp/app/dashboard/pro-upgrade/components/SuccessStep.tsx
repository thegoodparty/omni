'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ProBadge } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import Confetti from 'app/dashboard/questions/components/Confetti'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

// Post-payment, the candidate lands on the Campaign Manager dashboard, where
// `ProUpgrade3ComplianceCard` surfaces PIN entry (then review/approved/denied as
// the TCR record progresses) once `isPro` flips. The same card also lives on the
// profile page as a secondary location, but the dashboard is the primary
// post-upgrade destination (ENG-10361).
const DASHBOARD_PATH = '/dashboard'

// Post-payment landing (Stripe embedded-checkout return_url + PaymentStep's
// on-confirm nav). Purely presentational: `isPro` flips asynchronously via the
// webhook, so this screen never gates on it — it celebrates and routes onward,
// and the dashboard reflects live state once the candidate arrives.
const SuccessStep = (): React.JSX.Element => {
  const router = useRouter()

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessViewed)
  }, [])

  const handleContinue = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessContinue)
    router.push(DASHBOARD_PATH)
  }

  return (
    <>
      <Confetti />
      <div className="mx-auto flex max-w-[448px] flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-blue-100">
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

        <Button size="large" className="w-full" onClick={handleContinue}>
          Continue
        </Button>
      </div>
    </>
  )
}

export default SuccessStep
