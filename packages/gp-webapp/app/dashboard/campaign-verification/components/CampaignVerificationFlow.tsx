'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Stepper } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import CampaignVerificationSteps, {
  type VerificationStep,
} from './CampaignVerificationSteps'

const STEP_INDEX: Record<VerificationStep, number> = {
  intro: 1,
  form: 2,
  submitted: 3,
}

const CampaignVerificationFlow = (): React.JSX.Element => {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Only 'submitted' is trusted from the URL — a refresh mid-form should
  // land back on the intro, not reopen an empty ElectionFilingForm.
  const initialStep: VerificationStep =
    searchParams?.get('step') === 'submitted' ? 'submitted' : 'intro'
  // Mirrors the steps' own state, for the bar below — the steps component
  // owns the state machine (and the URL sync belongs here, not inside the
  // embeddable component, so a caller mounting it in a sheet doesn't get a
  // surprise navigation).
  const [step, setStep] = useState<VerificationStep>(initialStep)

  const handleStepChange = (next: VerificationStep) => {
    setStep(next)
    if (next === 'submitted') {
      router.replace('/dashboard/campaign-verification?step=submitted')
    }
  }

  return (
    <div className="min-h-screen bg-white px-6">
      <nav className="py-3">
        <Button
          asChild
          variant="ghost"
          size="small"
          className="text-base-muted-foreground"
        >
          <Link href="/dashboard">
            <ArrowLeftIcon /> Exit
          </Link>
        </Button>
      </nav>
      <main className="mx-auto max-w-screen-sm pt-6 pb-20">
        {step !== 'submitted' && (
          <Stepper
            variant="bar"
            overline="Campaign verification"
            currentStep={STEP_INDEX[step]}
            totalSteps={2}
            className="mb-6"
          />
        )}
        <div className="rounded-2xl border border-base-border bg-white p-6 md:px-12 md:py-8">
          <CampaignVerificationSteps
            initialStep={initialStep}
            onStepChange={handleStepChange}
            onExit={() => router.push('/dashboard')}
            onComplete={() => router.push('/dashboard')}
          />
        </div>
      </main>
    </div>
  )
}

export default CampaignVerificationFlow
