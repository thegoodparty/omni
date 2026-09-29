'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, ProBadge } from '@styleguide'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import {
  CheckCircleIcon,
  CheckIcon,
  ClipboardListIcon,
  ShieldCheckIcon,
} from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'
import {
  CAMPAIGN_QUERY_KEY,
  fetchCampaign,
} from '@shared/hooks/CampaignProvider'
import Confetti from 'app/dashboard/questions/components/Confetti'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ConfettiField } from './ConfettiField'
import { ProReceiptCard } from './ProReceiptCard'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// `isPro` flips server-side only when the Stripe `checkout.session.completed`
// webhook lands, which can lag the candidate arriving here. Poll the shared
// campaign query until it flips, then stop — or give up after the webhook
// window so a never-arriving flip doesn't poll forever.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

// What the purchase-only flow (outreach-pro-gating-v2) unlocks the moment Pro
// activates; filing details and the profile are collected afterwards, in
// campaign verification.
const UNLOCKED_ROWS = [
  'Individual voter records for your race',
  'Downloads and targeted lists',
  'Door knocking, phone banking and robocalls',
]

const VERIFICATION_BODY =
  'Your payment went through. One step left before you can send.'

const NEXT_NOUN = {
  robocall: 'schedule your robocall',
  door: 'build your walk list',
  'phone-bank': 'download your call list',
} as const

const NEXT_STEP_BODY = {
  robocall: 'Pick a date and time, review the cost, and pay for the calls.',
  door: 'Build the route, then save your walk list and start knocking.',
  'phone-bank': 'Download your call list, then start calling.',
} as const

// Post-payment landing (Stripe embedded-checkout return_url + PaymentStep's
// on-confirm nav). Purely presentational: it never gates its content on the
// webhook-driven `isPro` flip, so it can't get stuck. It does refresh the shared
// campaign cache in the background so the dashboard's "Get Pro" banner — which
// reads the cached `isPro` — is already hidden when the candidate continues,
// instead of lingering until a manual page refresh. The purchase-only screen
// does hold its Continue until `isPro` lands (or the poll gives up), because it
// hands off to campaign verification, which reads the Pro state it asserts.
const SuccessStep = (): React.JSX.Element => {
  // `complete` owns where the candidate goes next. On the standalone page that
  // is the Campaign Manager dashboard, where `ProUpgrade3ComplianceCard`
  // surfaces PIN entry (then review/approved/denied as the TCR record
  // progresses) once `isPro` flips. The same card also lives on the profile
  // page as a secondary location, but the dashboard is the primary
  // post-upgrade destination (ENG-10361).
  const { purchaseOnly, channel, complete, exit } = useProUpgradeWizard()
  const [pollExpired, setPollExpired] = useState(false)

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessViewed)
    const timer = setTimeout(() => setPollExpired(true), POLL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  // Same key as CampaignProvider (deduped) so the refetch updates the campaign
  // every consumer reads. `staleTime: 0` fires the first refetch on mount (the
  // webhook may already have landed); the interval stops once Pro or expired.
  const { data } = useQuery({
    queryKey: CAMPAIGN_QUERY_KEY,
    queryFn: fetchCampaign,
    staleTime: 0,
    refetchInterval: (query) =>
      !pollExpired && !query.state.data?.isPro ? POLL_INTERVAL_MS : false,
  })

  const handleContinue = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.SuccessContinue)
    complete()
  }

  if (purchaseOnly) {
    // The standalone page has no launch channel, and it hands off to campaign
    // verification, so it reads the same as the texting entry point.
    const nextStep =
      channel === 'sms' || channel === null
        ? null
        : { noun: NEXT_NOUN[channel], body: NEXT_STEP_BODY[channel] }

    // Design: the "paid" screen — confetti through the column, the PRO badge
    // in its circle, the unlocked / still-to-do card, and a footer of Finish
    // later beside the next step, pinned to the bottom of the host's column.
    return (
      <div className="relative flex min-h-full flex-1 flex-col gap-3">
        <ConfettiField />
        <div className="relative flex flex-col items-center gap-4 pt-2 text-center">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-light">
            <ProBadge />
          </span>
          <div className="flex max-w-[440px] flex-col items-center gap-2">
            <h1 className="text-2xl font-semibold">Welcome to Pro</h1>
            <p className="text-[15px] leading-relaxed text-base-muted-foreground">
              {nextStep
                ? `Payment successful. Your next step is to ${nextStep.noun}.`
                : VERIFICATION_BODY}
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-base-border bg-card text-left">
          <div className="flex items-start gap-3 px-4 py-3.5">
            <CheckCircleIcon
              className="mt-0.5 size-[18px] shrink-0 text-primary"
              aria-hidden
            />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-semibold">Unlocked now</p>
              <ul className="flex flex-col gap-1.5">
                {UNLOCKED_ROWS.map((row) => (
                  <li
                    key={row}
                    className="flex items-start gap-2 text-sm text-base-muted-foreground"
                  >
                    <CheckIcon
                      className="mt-0.5 size-3.5 shrink-0 text-primary"
                      aria-hidden
                    />
                    {row}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex items-start gap-3 border-t border-base-border px-4 py-3.5">
            {nextStep ? (
              <ClipboardListIcon
                className="mt-0.5 size-[18px] shrink-0 text-primary"
                aria-hidden
              />
            ) : (
              <ShieldCheckIcon
                className="mt-0.5 size-[18px] shrink-0 text-primary"
                aria-hidden
              />
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-semibold">
                {nextStep
                  ? `Still to do: ${nextStep.noun}`
                  : 'Still to do: verification'}
              </p>
              <p className="text-sm text-base-muted-foreground">
                {nextStep
                  ? nextStep.body
                  : 'Add your campaign filing details, we register your texting account with the carriers, and you get a PIN when it clears, usually 1 to 2 weeks.'}
              </p>
            </div>
          </div>
        </div>

        <ProReceiptCard enabled={Boolean(data?.isPro)} />

        <StepFooter>
          <Button
            variant="ghost"
            size="large"
            className="w-full sm:w-auto"
            onClick={exit}
          >
            Finish later
          </Button>
          <Button
            size="large"
            className="w-full sm:w-auto sm:min-w-[360px]"
            onClick={handleContinue}
            disabled={!data?.isPro && !pollExpired}
          >
            {nextStep ? 'Continue' : 'Start verification'}
          </Button>
        </StepFooter>
      </div>
    )
  }

  return (
    <>
      <Confetti />
      <div className="mx-auto flex max-w-[448px] flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary-light">
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
