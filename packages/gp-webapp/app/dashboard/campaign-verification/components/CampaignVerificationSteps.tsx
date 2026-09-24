'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@styleguide'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import { CheckCircleIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ElectionFilingForm from 'app/dashboard/profile/texting-compliance/election-filing/components/ElectionFilingForm'
import { ConfettiField } from 'app/dashboard/pro-upgrade/components/ConfettiField'
import { VerificationIntro } from './VerificationIntro'

export type VerificationStep = 'intro' | 'form' | 'submitted'

// The design's filing-details/contact-information headings, only shown when
// this component renders the filing form — the legacy standalone
// election-filing page keeps its current (heading-less) look by not passing
// them to ElectionFilingForm.
const FILING_DETAILS_TITLE = 'What are your campaign filing details?'
const FILING_DETAILS_CAPTION =
  'If these do not match the details you submitted on your campaign filing or registration, it will take much longer before you can send text messages.'
const FILING_CONTACT_TITLE = 'What is your campaign filing contact information?'
const FILING_CONTACT_CAPTION =
  'Enter the email, phone, or address exactly as it appears on your filing document. A PIN will be sent to one of these to verify your campaign.'

const PIN_NOTICE_TITLE = 'A PIN is on its way'
const PIN_NOTICE_BODY =
  'After your campaign is verified, a PIN will be sent to the email, phone, or address that matches your election filing, usually 1 to 2 weeks. Entering the PIN unlocks texting.'

interface CampaignVerificationStepsProps {
  // Lets a caller resume on a step other than the intro (e.g. a page wrapper
  // mapping `?step=submitted` on refresh). Defaults to 'intro'.
  initialStep?: VerificationStep
  // Fired on mount and on every step change so a caller-owned chrome (a page
  // Stepper, a URL) can track the active step without this component
  // reaching outside its own props.
  onStepChange?: (step: VerificationStep) => void
  onExit: () => void
  onComplete: () => void
  completeLabel?: string
}

// The intro → filing form → submitted-confirmation state machine, with no
// page chrome of its own (no min-h-screen, no nav, no Stepper) — a caller's
// sheet or page wrapper owns that, and each screen pins its own footer to
// the bottom of the caller's column.
const CampaignVerificationSteps = ({
  initialStep = 'intro',
  onStepChange,
  onExit,
  onComplete,
  completeLabel = 'Done',
}: CampaignVerificationStepsProps): React.JSX.Element => {
  const [step, setStep] = useState<VerificationStep>(initialStep)

  // Reset scroll to the top whenever the active step changes (dashboard
  // convention), and let the caller track the active step. Only `step`
  // belongs in the deps — `onStepChange` is typically a fresh inline
  // callback on every caller render, and this must fire on step transitions
  // only, not on every caller re-render.
  useEffect(() => {
    window.scrollTo(0, 0)
    onStepChange?.(step)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // One intro view per mount of these steps. The intro is unmounted by the
  // form step and remounted by Back, so a view fired from its own mount
  // counted twice; the ref lives here, where it survives that.
  const introViewedRef = useRef(false)
  useEffect(() => {
    if (step !== 'intro' || introViewedRef.current) return
    introViewedRef.current = true
    trackEvent(EVENTS.ProUpgrade.Verification.IntroViewed)
  }, [step])

  useEffect(() => {
    if (step === 'submitted') {
      trackEvent(EVENTS.ProUpgrade.Verification.SubmittedViewed)
    }
  }, [step])

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {step === 'intro' && (
        <VerificationIntro
          onBack={onExit}
          onContinue={() => {
            trackEvent(EVENTS.ProUpgrade.Verification.IntroContinue)
            setStep('form')
          }}
        />
      )}
      {step === 'form' && (
        <ElectionFilingForm
          variant="verification"
          title={FILING_DETAILS_TITLE}
          caption={FILING_DETAILS_CAPTION}
          contactTitle={FILING_CONTACT_TITLE}
          contactCaption={FILING_CONTACT_CAPTION}
          onBack={() => setStep('intro')}
          onSubmitted={() => setStep('submitted')}
        />
      )}
      {step === 'submitted' && (
        // Design: the pending screen — confetti through the column, the
        // check in its circle, the PIN notice card, and a single centered
        // Done.
        <div className="relative flex min-h-full flex-1 flex-col">
          <ConfettiField />
          <div className="relative flex flex-col items-center gap-4 pt-2 text-center">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-light">
              <CheckCircleIcon className="size-8 text-primary" aria-hidden />
            </span>
            <div className="flex max-w-[440px] flex-col items-center gap-2">
              <h1 className="text-2xl font-semibold">
                Submitted for verification
              </h1>
              <p className="text-[15px] leading-relaxed text-base-muted-foreground">
                Your campaign has been submitted for verification.
              </p>
            </div>
          </div>
          <div className="relative mt-4 flex flex-col gap-1.5 rounded-xl border border-base-border bg-card p-4">
            <p className="text-sm font-semibold">{PIN_NOTICE_TITLE}</p>
            <p className="text-[13px] leading-relaxed text-base-muted-foreground">
              {PIN_NOTICE_BODY}
            </p>
          </div>
          <StepFooter align="center">
            <Button
              size="large"
              className="w-full sm:w-auto sm:min-w-[360px]"
              onClick={onComplete}
            >
              {completeLabel}
            </Button>
          </StepFooter>
        </div>
      )}
    </div>
  )
}

export default CampaignVerificationSteps
