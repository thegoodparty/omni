'use client'

import { useQuery } from '@tanstack/react-query'
import { PeerlyCvVerificationStatus } from '@goodparty_org/contracts'
import type { PinDelivery } from '@goodparty_org/contracts'
import {
  COMPLIANCE_STATE_QUERY_KEY,
  TCR_COMPLIANCE_STATUS,
  getComplianceState,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import type { TcrCompliance } from 'helpers/types'

export const CV_PIN_GATE = {
  LOADING: 'loading',
  NOT_AWAITING_PIN: 'not_awaiting_pin',
  VERIFICATION_IN_PROGRESS: 'verification_in_progress',
  READY: 'ready',
} as const

export type CvPinGateState = (typeof CV_PIN_GATE)[keyof typeof CV_PIN_GATE]

export interface CvPinGate {
  state: CvPinGateState
  pinDelivery: PinDelivery | null
}

interface UseCvPinGateOptions {
  // Pass the TCR query's own pending flag so the gate reports LOADING instead
  // of NOT_AWAITING_PIN while the record is still in flight.
  isTcrPending?: boolean
}

// Peerly issues a PIN only once CampaignVerify reaches APPROVED; VERIFIED
// means one was issued and already consumed (a retry after a downstream
// failure still needs the box). Everything else — REQUESTED, IN_REVIEW,
// REJECTED, or no CV request at all — means no PIN exists.
export const isPinIssued = (cvStatus: string | null | undefined): boolean =>
  cvStatus === PeerlyCvVerificationStatus.APPROVED ||
  cvStatus === PeerlyCvVerificationStatus.VERIFIED

// One gate for every PIN-entry surface. It used to be reimplemented per
// surface, so only the Pro-upgrade card ever learned about the live CV status
// and the other two showed a PIN box before a PIN existed (ENG-10866).
export const useCvPinGate = (
  tcrCompliance: TcrCompliance | null | undefined,
  { isTcrPending = false }: UseCvPinGateOptions = {},
): CvPinGate => {
  const isAwaitingPin =
    tcrCompliance?.status === TCR_COMPLIANCE_STATUS.SUBMITTED

  // Only the awaiting-PIN state gates on the live Peerly CV status, so the
  // extra Peerly read stays off every other candidate's page load.
  // staleTime 0 overrides the app-wide 5-minute default: all three PIN surfaces
  // share this cache key, so a candidate who opens one, gets approved by
  // CampaignVerify, then opens another would otherwise be gated on a stale
  // IN_REVIEW and see no PIN form. Serving a stale status defeats the gate.
  const { data: complianceState, isPending: isCvStatePending } = useQuery({
    queryKey: COMPLIANCE_STATE_QUERY_KEY,
    queryFn: getComplianceState,
    enabled: isAwaitingPin,
    staleTime: 0,
  })

  if (isTcrPending) {
    return { state: CV_PIN_GATE.LOADING, pinDelivery: null }
  }
  if (!isAwaitingPin) {
    return { state: CV_PIN_GATE.NOT_AWAITING_PIN, pinDelivery: null }
  }
  if (isCvStatePending) {
    return { state: CV_PIN_GATE.LOADING, pinDelivery: null }
  }
  return isPinIssued(complianceState?.peerlyCvStatus)
    ? {
        state: CV_PIN_GATE.READY,
        pinDelivery: complianceState?.pinDelivery ?? null,
      }
    : { state: CV_PIN_GATE.VERIFICATION_IN_PROGRESS, pinDelivery: null }
}
