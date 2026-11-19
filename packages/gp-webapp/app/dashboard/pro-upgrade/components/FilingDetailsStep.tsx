'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@styleguide'
import {
  TCR_COMPLIANCE_QUERY_KEY,
  getTcrCompliance,
  getTcrComplianceStatusCompletions,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import ElectionFilingForm from 'app/dashboard/profile/texting-compliance/election-filing/components/ElectionFilingForm'
import {
  FILING_CONTACT_CAPTION,
  FILING_CONTACT_TITLE,
  FILING_DETAILS_CAPTION,
  FILING_DETAILS_TITLE,
  DETAILS_SAVED_BODY,
  DETAILS_SAVED_TITLE,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { StepFooter } from 'app/dashboard/shared/StepFooter'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import { useProUpgradeWizard } from './ProUpgradeWizard'

// Campaign verification's own form, asked before payment. Its submit is the same createAgentic call, so a
// non-Pro candidate's agent run still waits for the payment webhook.
const FilingDetailsStep = (): React.JSX.Element => {
  const { goToNextStep, goToPreviousStep } = useProUpgradeWizard()
  const { data: tcrCompliance, isPending } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
  })
  const smsClosed = useSmsCompliance().smsCompliance === 'closed'

  // createAgentic returns an existing record unchanged, so a candidate who
  // submitted and came back without paying would retype a form that saves
  // nothing. Decided once: the form's own submit refetches the record, and
  // a live read would swap the form out before it advances.
  const [alreadySubmitted, setAlreadySubmitted] = useState<boolean | null>(null)
  useEffect(() => {
    if (alreadySubmitted !== null || isPending) return
    setAlreadySubmitted(
      getTcrComplianceStatusCompletions(tcrCompliance).filingComplete,
    )
  }, [alreadySubmitted, isPending, tcrCompliance])

  if (alreadySubmitted === null) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }

  if (alreadySubmitted) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{DETAILS_SAVED_TITLE}</h1>
          {!smsClosed && (
            <p className="text-base text-base-muted-foreground">
              {DETAILS_SAVED_BODY}
            </p>
          )}
        </div>
        <StepFooter>
          <Button
            variant="ghost"
            size="large"
            className="w-full sm:w-auto"
            onClick={goToPreviousStep}
          >
            Back
          </Button>
          <Button
            size="large"
            className="w-full sm:w-auto sm:min-w-[360px]"
            onClick={goToNextStep}
          >
            Continue
          </Button>
        </StepFooter>
      </div>
    )
  }

  return (
    <ElectionFilingForm
      variant="verification"
      title={FILING_DETAILS_TITLE}
      caption={FILING_DETAILS_CAPTION}
      contactTitle={FILING_CONTACT_TITLE}
      contactCaption={FILING_CONTACT_CAPTION}
      onBack={goToPreviousStep}
      onSubmitted={goToNextStep}
      // The submit still files the record; payment is what sets the rest in
      // motion, so the step reads like any other wizard step.
      submitLabel="Continue"
      persistDraft
    />
  )
}

export default FilingDetailsStep
