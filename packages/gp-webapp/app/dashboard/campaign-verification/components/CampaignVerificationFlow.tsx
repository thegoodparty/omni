'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  FullScreenStepChrome,
  type StepPosition,
} from 'app/dashboard/shared/FullScreenStepChrome'
import { GATE_CHROME_COPY } from 'app/dashboard/outreach/v2/gate/gateCopy'
import CampaignVerificationSteps, {
  type VerificationStep,
} from './CampaignVerificationSteps'

// The same positions OutreachGate reports for the embedded steps: the intro
// and the form count, and the submitted screen draws no header at all
// (design: the pending screen).
const STEP_POSITION: Record<VerificationStep, StepPosition | null> = {
  intro: { currentStep: 1, totalSteps: 3 },
  form: { currentStep: 2, totalSteps: 3 },
  submitted: null,
}

const CampaignVerificationFlow = (): React.JSX.Element => {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Only 'submitted' is trusted from the URL. Otherwise the steps pick the
  // form or the intro from whether a draft is saved.
  const submittedOnLoad = searchParams?.get('step') === 'submitted'
  // Mirrors the steps' own state, for the bar above — the steps component
  // owns the state machine (and the URL sync belongs here, not inside the
  // embeddable component, so a caller mounting it in a sheet doesn't get a
  // surprise navigation).
  const [step, setStep] = useState<VerificationStep>(
    submittedOnLoad ? 'submitted' : 'intro',
  )

  const handleStepChange = (next: VerificationStep) => {
    setStep(next)
    if (next === 'submitted') {
      router.replace('/dashboard/campaign-verification?step=submitted')
    }
  }

  const exit = () => router.push('/dashboard')

  return (
    <FullScreenStepChrome
      overline={GATE_CHROME_COPY.verification}
      position={STEP_POSITION[step]}
      onExit={exit}
    >
      <CampaignVerificationSteps
        initialStep={submittedOnLoad ? 'submitted' : undefined}
        onStepChange={handleStepChange}
        onExit={exit}
        onComplete={exit}
      />
    </FullScreenStepChrome>
  )
}

export default CampaignVerificationFlow
