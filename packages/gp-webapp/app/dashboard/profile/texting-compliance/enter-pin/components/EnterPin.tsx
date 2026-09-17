'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import H2 from '@shared/typography/H2'
import H5 from '@shared/typography/H5'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import TextingComplianceHeader from 'app/dashboard/profile/texting-compliance/shared/TextingComplianceHeader'
import {
  TCR_COMPLIANCE_QUERY_KEY,
  TCR_COMPLIANCE_STATUS,
  getTcrCompliance,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import { getPinChannels } from 'app/dashboard/profile/texting-compliance/shared/pinChannels'
import { useSubmitCvPin } from 'app/dashboard/profile/texting-compliance/shared/useSubmitCvPin'
import {
  CV_PIN_GATE,
  useCvPinGate,
} from 'app/dashboard/profile/texting-compliance/shared/useCvPinGate'
import PinForm from 'app/dashboard/profile/texting-compliance/shared/PinForm'
import CvVerificationInProgressNotice from 'app/dashboard/profile/texting-compliance/shared/CvVerificationInProgressNotice'
import PinStepUnavailableNotice from 'app/dashboard/profile/texting-compliance/shared/PinStepUnavailableNotice'

const PROFILE_ROUTE = '/dashboard/account'

const REDIRECT_STATUSES: ReadonlyArray<string> = [
  TCR_COMPLIANCE_STATUS.PENDING,
  TCR_COMPLIANCE_STATUS.APPROVED,
]

export default function EnterPin(): React.JSX.Element {
  const router = useRouter()

  const { data: tcrCompliance, isPending } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
  })

  const { submit, submitting, error } = useSubmitCvPin(tcrCompliance, {
    onSuccess: () => router.push(PROFILE_ROUTE),
  })

  const status = tcrCompliance?.status ?? null
  const shouldRedirect = status !== null && REDIRECT_STATUSES.includes(status)

  // The local `submitted` status only means the registration reached Peerly;
  // whether a PIN exists is the live CampaignVerify status (ENG-10866).
  const pinGate = useCvPinGate(tcrCompliance, { isTcrPending: isPending })
  const pinReady = pinGate.state === CV_PIN_GATE.READY

  useEffect(() => {
    if (shouldRedirect) {
      router.push(PROFILE_ROUTE)
    }
  }, [shouldRedirect, router])

  // Funnel "viewed" event for the agentic compliance flow (ENG-10294). Fire
  // only once the PIN entry UI is actually shown — this page redirects away for
  // PENDING/APPROVED, so a bare mount event would count users who never see it.
  // The matching "submitted" signal is the PinVerificationCompleted event
  // fired by useSubmitCvPin.
  const pinViewTrackedRef = useRef(false)
  useEffect(() => {
    if (!pinReady || pinViewTrackedRef.current) return
    pinViewTrackedRef.current = true
    trackEvent(EVENTS.ProUpgrade.Compliance.PinEntryViewed)
  }, [pinReady])

  return (
    <div className="bg-white pt-2 md:pt-0">
      <TextingComplianceHeader>
        <H5 className="flex-1 text-center md:hidden">Enter your PIN</H5>
      </TextingComplianceHeader>

      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8 mt-16 md:mt-0">
        <H2 className="mb-6 hidden md:block">Enter your PIN</H2>

        {shouldRedirect || pinGate.state === CV_PIN_GATE.LOADING ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : pinGate.state === CV_PIN_GATE.NOT_AWAITING_PIN ? (
          <PinStepUnavailableNotice />
        ) : pinReady ? (
          <PinForm
            channels={getPinChannels(tcrCompliance)}
            onSubmit={submit}
            loading={submitting}
            error={error}
          />
        ) : (
          <CvVerificationInProgressNotice />
        )}
      </div>
    </div>
  )
}
