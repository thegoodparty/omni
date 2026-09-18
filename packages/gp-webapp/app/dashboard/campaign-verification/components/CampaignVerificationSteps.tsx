'use client'

import { useEffect, useState } from 'react'
import { Button } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ElectionFilingForm from 'app/dashboard/profile/texting-compliance/election-filing/components/ElectionFilingForm'
import VerificationSubmittedContent from 'app/dashboard/profile/texting-compliance/verification-submitted/components/VerificationSubmittedContent'
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
  onDelete?: () => void
  deleteLabel?: string
  completeLabel?: string
}

// The intro → filing form → submitted-confirmation state machine, with no
// page chrome of its own (no min-h-screen, no nav, no Stepper) — a caller's
// sheet or page wrapper owns that. Extracted from CampaignVerificationFlow so
// a later task can mount the same steps inside the outreach flows.
const CampaignVerificationSteps = ({
  initialStep = 'intro',
  onStepChange,
  onExit,
  onComplete,
  onDelete,
  deleteLabel = 'Delete draft',
  completeLabel = 'Back to dashboard',
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

  useEffect(() => {
    if (step === 'submitted') {
      trackEvent(EVENTS.ProUpgrade.Verification.SubmittedViewed)
    }
  }, [step])

  return (
    <div>
      {onDelete && step !== 'submitted' && (
        <div className="mb-4 flex justify-end">
          <Button
            variant="ghost"
            size="small"
            className="text-base-muted-foreground"
            onClick={onDelete}
          >
            {deleteLabel}
          </Button>
        </div>
      )}
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
        <>
          <Button
            variant="ghost"
            size="small"
            className="mb-4 text-base-muted-foreground"
            onClick={() => setStep('intro')}
          >
            <ArrowLeftIcon /> Back
          </Button>
          <ElectionFilingForm
            title={FILING_DETAILS_TITLE}
            caption={FILING_DETAILS_CAPTION}
            contactTitle={FILING_CONTACT_TITLE}
            contactCaption={FILING_CONTACT_CAPTION}
            onSubmitted={() => setStep('submitted')}
          />
        </>
      )}
      {step === 'submitted' && (
        <VerificationSubmittedContent
          primaryAction={
            <Button size="large" className="w-full" onClick={onComplete}>
              {completeLabel}
            </Button>
          }
        />
      )}
    </div>
  )
}

export default CampaignVerificationSteps
