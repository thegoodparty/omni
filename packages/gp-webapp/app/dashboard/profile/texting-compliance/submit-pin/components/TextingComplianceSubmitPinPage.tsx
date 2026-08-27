'use client'
import { TakeoverShell } from 'app/dashboard/shared/takeover/TakeoverShell'
import { VerificationBadge } from 'app/dashboard/shared/takeover/VerificationBadge'
import { FormDataProvider } from '@shared/hooks/useFormData'
import {
  TextingComplianceSubmitPinForm,
  validatePinForm,
  PinFormData,
} from 'app/dashboard/profile/texting-compliance/submit-pin/components/TextingComplianceSubmitPinForm'
import { useRouter } from 'next/navigation'
import { useSubmitCvPin } from 'app/dashboard/profile/texting-compliance/shared/useSubmitCvPin'
import {
  CV_PIN_GATE,
  useCvPinGate,
} from 'app/dashboard/profile/texting-compliance/shared/useCvPinGate'
import CvVerificationInProgressNotice from 'app/dashboard/profile/texting-compliance/shared/CvVerificationInProgressNotice'
import PinStepUnavailableNotice from 'app/dashboard/profile/texting-compliance/shared/PinStepUnavailableNotice'
import type { TcrCompliance } from 'helpers/types'

interface TextingComplianceSubmitPinPageProps {
  tcrCompliance: TcrCompliance
}

const initialFormState: PinFormData = {
  pin: '',
}

const TextingComplianceSubmitPinPage = ({
  tcrCompliance,
}: TextingComplianceSubmitPinPageProps): React.JSX.Element => {
  const router = useRouter()
  // This page had no gate at all, so it would render the PIN form for a
  // record whose CampaignVerify request had never issued a PIN (ENG-10866).
  const pinGate = useCvPinGate(tcrCompliance)
  // Shares the submit path with /enter-pin and the Pro-upgrade card. Its own
  // clientFetch version discarded the HTTP status, so the 409 that means "no
  // PIN was ever issued" was indistinguishable from a wrong PIN and this route
  // could only ever show a generic failure.
  const { submit, submitting, error } = useSubmitCvPin(tcrCompliance, {
    onSuccess: () => router.push('/dashboard/account'),
  })

  const handleFormSubmit = ({ pin }: PinFormData) => submit(pin)

  return (
    <TakeoverShell
      eyebrow="Verify campaign"
      progressValue={100}
      closeHref="/dashboard/account"
    >
      <div className="mb-4 flex">
        <VerificationBadge />
      </div>
      <div>
        <h1 className="mb-6 text-xl font-semibold">Enter your PIN</h1>

        {pinGate.state === CV_PIN_GATE.LOADING ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : pinGate.state === CV_PIN_GATE.NOT_AWAITING_PIN ? (
          <PinStepUnavailableNotice />
        ) : pinGate.state === CV_PIN_GATE.READY ? (
          <FormDataProvider
            initialState={initialFormState}
            validator={validatePinForm}
          >
            <TextingComplianceSubmitPinForm
              {...{
                onSubmit: handleFormSubmit,
                loading: submitting,
                error,
              }}
            />
          </FormDataProvider>
        ) : (
          <CvVerificationInProgressNotice />
        )}
      </div>
    </TakeoverShell>
  )
}

export default TextingComplianceSubmitPinPage
