'use client'

import { useEffect } from 'react'
import { format, isValid, parseISO } from 'date-fns'
import { Button } from '@styleguide'
import { CreditCardIcon, FileTextIcon } from '@styleguide/components/ui/icons'
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

// The purchase-only flow (outreach-pro-gating-v2) collects filing details and
// the candidate profile after payment, so this screen only sets up the two
// things still gathered before checkout.
const PURCHASE_ONLY_ROWS = [
  {
    icon: FileTextIcon,
    title: 'Your campaign EIN',
    body: 'Your campaign EIN confirms your campaign is a real tax entity.',
  },
  {
    icon: CreditCardIcon,
    title: 'Payment',
    body: 'Add your payment details to activate Pro at $10 per month. You can cancel any time.',
  },
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
  const { purchaseOnly, goToStep, goToPreviousStep, exit } =
    useProUpgradeWizard()
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
    // the EIN step rather than via goToNextStep. In the purchase-only order
    // guidance leads the flow, so the filing-status question comes next.
    goToStep(purchaseOnly ? PRO_UPGRADE_STEP.STATUS : PRO_UPGRADE_STEP.EIN)
  }

  if (purchaseOnly) {
    return (
      <div>
        <h1 className="text-[32px] leading-[44px] font-semibold mb-1.5">
          Let&apos;s gather a few things to unlock Pro
        </h1>
        <Body2 className="text-base-muted-foreground mb-6">
          Have this information available to activate Pro.
        </Body2>

        <ul className="rounded-xl border border-base-border">
          {PURCHASE_ONLY_ROWS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex items-start gap-3 border-t border-base-border p-4 first:border-t-0"
            >
              <Icon
                className="mt-0.5 size-5 shrink-0 text-primary"
                aria-hidden
              />
              <span>
                <span className="block font-semibold">{title}</span>
                <Body2 className="text-base-muted-foreground">{body}</Body2>
              </span>
            </li>
          ))}
        </ul>

        <Body2 className="mt-5 text-base-muted-foreground">
          Ready when you are.
        </Body2>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            size="large"
            className="w-full sm:w-auto"
            onClick={exit}
          >
            Back
          </Button>
          <Button
            size="large"
            className="w-full sm:w-auto"
            onClick={handleContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    )
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
