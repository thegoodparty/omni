'use client'

import { useEffect } from 'react'
import { format, isValid, parseISO } from 'date-fns'
import { Button } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import { useCampaign } from '@shared/hooks/useCampaign'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PRO_UPGRADE_STEP } from '../proUpgradeStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// The four things the rest of the wizard collects, in the order the candidate
// encounters them (EIN → filing details → candidate profile → payment). Per
// the Figma "guidance" frame three are plain labels; item 2 ("Your campaign
// filing details") also shows the filing window when it's known. This screen
// is presentational only: it sets expectations and neither reads nor writes
// any of these.
const GATHER_STEPS = [
  'Your campaign EIN',
  'Your campaign filing details',
  'Your candidate profile',
  'Payment',
]

// Mirrors gp-api's buildFilingInstructionsContent / formatFilingWindow
// (filingInstructions.util.ts) so the date shown here can't drift from the
// dead-end filing-instructions screen, which renders the same window from the
// same campaign.details fields. Falls back to the raw value rather than
// dropping it when the loosely-typed details JSON holds an unparseable string.
const formatFilingDate = (value: string | null | undefined): string | null => {
  if (!value) return null
  const parsed = parseISO(value)
  return isValid(parsed) ? format(parsed, 'MMMM d, yyyy') : value
}

const formatFilingWindow = (
  start: string | null | undefined,
  end: string | null | undefined,
): string | null => {
  const formattedStart = formatFilingDate(start)
  const formattedEnd = formatFilingDate(end)
  if (formattedStart && formattedEnd) {
    return `${formattedStart} – ${formattedEnd}`
  }
  return formattedStart ?? formattedEnd ?? null
}

const GuidanceStep = (): React.JSX.Element => {
  const { goToStep, goToPreviousStep } = useProUpgradeWizard()
  const [campaign] = useCampaign()

  const filingWindow = formatFilingWindow(
    campaign?.details?.filingPeriodsStart,
    campaign?.details?.filingPeriodsEnd,
  )

  useEffect(() => {
    trackEvent(EVENTS.ProUpgrade.Compliance.GuidanceViewed)
  }, [])

  const handleContinue = (): void => {
    trackEvent(EVENTS.ProUpgrade.Compliance.GuidanceContinue)
    // GUIDANCE is off the linear step order (the router can't derive an
    // interstitial with no persisted "seen" state), so advance explicitly to
    // the EIN step rather than via goToNextStep.
    goToStep(PRO_UPGRADE_STEP.EIN)
  }

  return (
    <div>
      <h1 className="text-[32px] leading-[44px] font-semibold mb-1.5">
        Great! We&apos;ll need to gather a few things to get you set up for
        texting
      </h1>
      <Body2 className="text-base-muted-foreground mb-6">
        This is required to access voter data and send texts.
      </Body2>

      <ol className="rounded-xl border border-base-border">
        {GATHER_STEPS.map((label, index) => {
          // Item 2 ("Your campaign filing details") surfaces the filing window
          // when we know it; the other three stay label-only.
          const detail = index === 1 ? filingWindow : null
          return (
            <li
              key={label}
              className="flex items-center gap-3 border-t border-base-border p-4 first:border-t-0"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tertiary-light text-tertiary-dark">
                {index + 1}
              </span>
              <span>
                <span className="block">{label}</span>
                {detail && (
                  <Body2 className="text-base-muted-foreground">{detail}</Body2>
                )}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          size="large"
          className="w-full sm:w-auto"
          onClick={goToPreviousStep}
        >
          Back
        </Button>
        <Button
          size="large"
          className="w-full sm:w-auto"
          onClick={handleContinue}
        >
          Let&apos;s go!
        </Button>
      </div>
    </div>
  )
}

export default GuidanceStep
