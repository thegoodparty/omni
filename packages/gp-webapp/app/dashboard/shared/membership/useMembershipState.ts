'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import {
  COMPLIANCE_STATE_QUERY_KEY,
  TCR_COMPLIANCE_QUERY_KEY,
  TCR_COMPLIANCE_STATUS,
  getComplianceState,
  getTcrCompliance,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import type { TcrCompliance } from 'helpers/types'
import {
  deriveMembershipState,
  type MembershipState,
} from './deriveMembershipState'

interface UseMembershipStateResult {
  ready: boolean
  state: MembershipState | null
  tcrCompliance: TcrCompliance | null
}

// One read for every membership surface. The compliance-state query fires a
// live Peerly read at the awaiting-PIN stage, so it is enabled only for a
// submitted record that reached Peerly and kept on the app default staleTime;
// the PIN dialog re-reads with staleTime 0 through useCvPinGate before it
// renders a box.
//
// `enabled` is how a flagged-off surface opts out of the reads entirely: the
// hook is called unconditionally (hooks always are), so without it every user
// outside the experiment would still pay for the TCR read. The campaign gate
// does the same for an org that has no campaign at all (Serve, or a user
// mid-onboarding): no campaign means no membership surface can render, so the
// reads would be paid for a UI that never appears. The elected-office query
// stays on — other consumers share it.
export const useMembershipState = ({
  enabled = true,
}: { enabled?: boolean } = {}): UseMembershipStateResult => {
  const [campaign] = useCampaign()
  const { data: electedOffice, isPending: electedOfficePending } =
    useElectedOffice()
  const { data: tcrCompliance, isPending: tcrPending } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
    enabled: enabled && Boolean(campaign),
  })

  const isAwaitingPinCandidate =
    tcrCompliance?.status === TCR_COMPLIANCE_STATUS.SUBMITTED &&
    Boolean(tcrCompliance?.peerlyIdentityId)

  const { data: complianceState, isPending: compliancePending } = useQuery({
    queryKey: COMPLIANCE_STATE_QUERY_KEY,
    queryFn: getComplianceState,
    enabled: enabled && Boolean(campaign) && isAwaitingPinCandidate,
  })

  const ready =
    enabled &&
    Boolean(campaign) &&
    !electedOfficePending &&
    !tcrPending &&
    (!isAwaitingPinCandidate || !compliancePending)

  const isPro = Boolean(campaign?.isPro)
  const isElectedOffice = Boolean(electedOffice)
  const tcrStatus = tcrCompliance?.status ?? null
  const hasPeerlyIdentity = Boolean(tcrCompliance?.peerlyIdentityId)
  const peerlyCvStatus = complianceState?.peerlyCvStatus ?? null
  const pinDelivery = complianceState?.pinDelivery ?? null

  // Derived on every call otherwise, so `state` was a NEW object on every
  // render of every consumer — and a consumer that keys anything on its
  // identity (the outreach history table's status filters) reset itself on
  // every unrelated re-render. The derivation is pure over these six.
  const state = useMemo(
    () =>
      deriveMembershipState({
        isPro,
        isElectedOffice,
        tcrStatus,
        hasPeerlyIdentity,
        peerlyCvStatus,
        pinDelivery,
      }),
    [
      isPro,
      isElectedOffice,
      tcrStatus,
      hasPeerlyIdentity,
      peerlyCvStatus,
      pinDelivery,
    ],
  )

  if (!ready) return { ready: false, state: null, tcrCompliance: null }

  return { ready: true, tcrCompliance: tcrCompliance ?? null, state }
}
