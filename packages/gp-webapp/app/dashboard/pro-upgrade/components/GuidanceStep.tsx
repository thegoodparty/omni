'use client'

import { useEffect } from 'react'
import { Button } from '@styleguide'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import { Alert, AlertTitle } from '@styleguide/components/ui/alert'
import {
  CalendarClockIcon,
  CreditCardIcon,
  FileBadgeIcon,
  InfoIcon,
} from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  CONTACT_DETAILS_ROW,
  FILING_DETAILS_ROW,
  PIN_TIMING_ROW,
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import { PRO_UPGRADE_STEP } from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// Design: sgBody's overview. Every launch gathers the filing details before
// payment, so the list carries campaign verification's own rows around the EIN
// and payment ones, with the wait for the PIN last.
const ROWS = [
  {
    icon: FileBadgeIcon,
    title: 'Your campaign EIN',
    body: 'Your campaign EIN helps verify your candidacy and comply with texting regulations.',
  },
  FILING_DETAILS_ROW,
  CONTACT_DETAILS_ROW,
  {
    icon: CreditCardIcon,
    title: 'Payment',
    body: 'Add your payment details to activate Pro at $10 per month. You can cancel any time.',
  },
  PIN_TIMING_ROW,
]

const GuidanceStep = (): React.JSX.Element => {
  const { channel, goToStep, goToPreviousStep, exit } = useProUpgradeWizard()
  const { smsCompliance, smsCutoffDate, generalElectionDate } =
    useSmsCompliance()
  const smsClosed = smsCompliance === 'closed'
  const cutoff = smsCutoffDate ? formatSmsCutoffDate(smsCutoffDate) : null

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.GuidanceViewed)
  }, [])

  const cutoffSource = channel ?? 'generic'
  useEffect(() => {
    if (!smsClosed) return
    trackEvent(EVENTS.ProUpgrade.SmsCutoff.NoticeViewed, {
      source: cutoffSource,
      cutoffDate: smsCutoffDate,
      generalElectionDate,
    })
  }, [smsClosed, cutoffSource, smsCutoffDate, generalElectionDate])

  const handleContinue = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.GuidanceContinue)
    if (smsClosed) {
      trackEvent(EVENTS.ProUpgrade.SmsCutoff.NoticeCompleted, {
        source: cutoffSource,
        cutoffDate: smsCutoffDate,
        generalElectionDate,
      })
    }
    // Guidance leads the flow, so the filing-status question comes next.
    goToStep(PRO_UPGRADE_STEP.STATUS)
  }

  // Closed: the steps stay, since they still verify the candidate, but the
  // PIN that would unlock texting is not coming.
  const smsBanner = smsClosed ? (
    <Alert variant="info" icon={<InfoIcon />} className="mb-6">
      <AlertTitle>{SMS_CUTOFF_COPY.closedReason(cutoff)}</AlertTitle>
    </Alert>
  ) : null
  const smsCountdown =
    smsCompliance === 'closing' && cutoff ? (
      <p className="mb-4 flex items-center gap-2 text-sm font-medium text-warning-dark">
        <CalendarClockIcon className="size-4 shrink-0" aria-hidden />
        {SMS_CUTOFF_COPY.guidanceClosing(cutoff)}
      </p>
    ) : null

  const rows = smsClosed ? ROWS.filter((row) => row !== PIN_TIMING_ROW) : ROWS
  return (
    // min-h-full + flex-col: inside the outreach sheet the footer row pins
    // to the bottom (design: renderSgModal's footerRow); in the route
    // shell's card the parent has no height to fill and this is inert.
    <div className="flex min-h-full flex-1 flex-col">
      {smsBanner}
      <h1 className="mb-2 text-xl font-semibold">
        Let&apos;s gather a few things to unlock Pro
      </h1>
      <p className="mb-6 text-base text-base-muted-foreground">
        Have this information available to verify your campaign.
      </p>

      {smsCountdown}

      <ul className="rounded-xl border border-base-border">
        {rows.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex min-h-16 items-start gap-3 border-t border-base-border px-4 py-3.5 first:border-t-0"
          >
            <Icon
              className="mt-0.5 size-[18px] shrink-0 text-primary"
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{title}</span>
              <span className="mt-0.5 block text-[13px] text-base-muted-foreground">
                {body}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-sm text-base-muted-foreground">
        Ready when you are.
      </p>

      <StepFooter>
        <Button
          variant="ghost"
          size="large"
          className="w-full sm:w-auto"
          // Launched from an outreach flow the pitch is behind this step;
          // on the standalone page there is nothing behind it but the exit.
          onClick={channel ? goToPreviousStep : exit}
        >
          Back
        </Button>
        <Button
          size="large"
          className="w-full sm:w-auto sm:min-w-[360px]"
          onClick={handleContinue}
        >
          Continue
        </Button>
      </StepFooter>
    </div>
  )
}

export default GuidanceStep
