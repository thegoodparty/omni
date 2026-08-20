'use client'
import { useState } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import {
  P2PUpgradeModal,
  P2P_MODAL_VARIANTS,
} from 'app/dashboard/shared/P2PUpgradeModal'
import { ComplianceModal } from 'app/dashboard/shared/ComplianceModal'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'

export const useTextOutreachGate = (
  tcrCompliance?: TcrCompliance,
  source = 'outreach_page',
) => {
  const [campaign] = useCampaign()
  const { isPro, hasFreeTextsOffer } = campaign || {}
  const [showP2PModal, setShowP2PModal] = useState(false)
  const [showComplianceModal, setShowComplianceModal] = useState(false)

  const isTextCompliant =
    tcrCompliance?.status === TCR_COMPLIANCE_STATUS.APPROVED

  const runTextGate = () => {
    if (!isPro) {
      setShowP2PModal(true)
      return false
    }
    if (!isTextCompliant) {
      trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceModalViewed, {
        source,
      })
      setShowComplianceModal(true)
      return false
    }
    return true
  }

  const gateModals = (
    <>
      <P2PUpgradeModal
        {...{
          variant: (() => {
            if (!isPro) return P2P_MODAL_VARIANTS.NonProUpgrade
            if (hasFreeTextsOffer && !isTextCompliant) {
              return P2P_MODAL_VARIANTS.ProFreeTextsNonCompliant
            }
            return P2P_MODAL_VARIANTS.NonProUpgrade
          })(),
          open: showP2PModal,
          onClose: () => setShowP2PModal(false),
          onUpgradeLinkClick: undefined,
        }}
      />

      <ComplianceModal
        {...{
          open: showComplianceModal,
          tcrComplianceStatus: tcrCompliance?.status,
          onClose: () => setShowComplianceModal(false),
        }}
      />
    </>
  )

  return { runTextGate, gateModals }
}
