'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Stepper } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import ElectionFilingForm from 'app/dashboard/profile/texting-compliance/election-filing/components/ElectionFilingForm'
import VerificationSubmittedContent from 'app/dashboard/profile/texting-compliance/verification-submitted/components/VerificationSubmittedContent'
import { VerificationIntro } from './VerificationIntro'

type VerificationStep = 'intro' | 'form' | 'submitted'

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
  const [step, setStep] = useState<VerificationStep>(
    searchParams?.get('step') === 'submitted' ? 'submitted' : 'intro',
  )

  // Reset scroll to the top whenever the active step changes (dashboard
  // convention) — the filing form is long enough that the confirmation would
  // otherwise render mid-page.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  // One intro view per visit to the flow. The intro is unmounted by the form
  // step and remounted by Back, so the event is fired from here, where the
  // ref survives that, rather than from the intro's own mount.
  const introViewedRef = useRef(false)
  useEffect(() => {
    if (step !== 'intro' || introViewedRef.current) return
    introViewedRef.current = true
    trackEvent(EVENTS.ProUpgrade.Verification.IntroViewed)
  }, [step])

  // Same guard for the submitted screen: a refresh of the submitted URL
  // mounts straight onto it, and the effect must not count that twice.
  const submittedViewedRef = useRef(false)
  useEffect(() => {
    if (step !== 'submitted' || submittedViewedRef.current) return
    submittedViewedRef.current = true
    trackEvent(EVENTS.ProUpgrade.Verification.SubmittedViewed)
  }, [step])

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
          {step === 'intro' && (
            <VerificationIntro
              onBack={() => router.push('/dashboard')}
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
                onSubmitted={() => {
                  setStep('submitted')
                  router.replace(
                    '/dashboard/campaign-verification?step=submitted',
                  )
                }}
              />
            </>
          )}
          {step === 'submitted' && <VerificationSubmittedContent />}
        </div>
      </main>
    </div>
  )
}

export default CampaignVerificationFlow
