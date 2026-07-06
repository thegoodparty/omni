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
import { useP2pUxEnabled } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'
import type { TcrCompliance } from 'helpers/types'

export const useTextOutreachGate = (tcrCompliance?: TcrCompliance) => {
  const { p2pUxEnabled } = useP2pUxEnabled()
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
    if (p2pUxEnabled && !isTextCompliant) {
      trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceModalViewed, {
        source: 'outreach_page',
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
            if (p2pUxEnabled && hasFreeTextsOffer && !isTextCompliant) {
              return P2P_MODAL_VARIANTS.ProFreeTextsNonCompliant
            }
            return P2P_MODAL_VARIANTS.NonProUpgrade
          })(),
          open: showP2PModal,
          onClose: () => setShowP2PModal(false),
          onUpgradeLinkClick: undefined,
        }}
      />

      {p2pUxEnabled && (
        <ComplianceModal
          {...{
            open: showComplianceModal,
            tcrComplianceStatus: tcrCompliance?.status,
            onClose: () => setShowComplianceModal(false),
          }}
        />
      )}
    </>
  )

  return { runTextGate, gateModals }
}
