'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import TaskFlow from 'app/dashboard/components/tasks/flows/TaskFlow'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import type { OutreachType } from 'gpApi/types/outreach.types'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import {
  getTcrCompliance,
  TCR_COMPLIANCE_QUERY_KEY,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'

// The outreach types a task card can start in place.
export type ComposeFlowType = Extract<OutreachType, 'text' | 'robocall'>

interface OpenFlow {
  type: ComposeFlowType
  due?: string
}

// The text gate needs the campaign's TCR compliance, which the outreach page
// fetches server-side. Surfaces that open the flow in place (campaign tracker,
// manager home) fetch it here instead; undefined (loading or error) simply
// makes the gate treat the campaign as not-yet-compliant. Uses the shared
// query key so completing TCR filing (which invalidates it) unblocks the gate
// here immediately.
const useTcrCompliance = (): TcrCompliance | undefined => {
  const { data } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
    staleTime: 5 * 60 * 1000,
  })
  return data ?? undefined
}

// Opens the outreach TaskFlow in place — no navigation — with the task's due
// date bound (campaignPlanDueDate rides the outreach record into the Slack
// notification). Applies the same gates the outreach page applies: the text
// gate (Pro + TCR compliance) for text, the Pro upgrade modal for robocall.
// Render `flowNode` once in the consuming surface; call `open` from a task CTA.
export const useOutreachComposeFlow = (
  source: string,
): {
  open: (type: ComposeFlowType, due?: string | null) => void
  flowNode: React.JSX.Element
} => {
  const [campaign] = useCampaign()
  const tcrCompliance = useTcrCompliance()
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance, source)
  const [flow, setFlow] = useState<OpenFlow | null>(null)
  const [showProUpgradeModal, setShowProUpgradeModal] = useState(false)

  const open = (type: ComposeFlowType, due?: string | null): void => {
    trackEvent(EVENTS.Outreach.ClickCreate, { type, source })
    const dueDate = due ? due.slice(0, 10) : undefined
    if (type === OUTREACH_TYPES.text) {
      if (runTextGate()) setFlow({ type, due: dueDate })
      return
    }
    if (!campaign?.isPro) {
      setShowProUpgradeModal(true)
      return
    }
    setFlow({ type, due: dueDate })
  }

  const flowNode = (
    <>
      {flow && campaign && (
        <TaskFlow
          forceOpen
          type={flow.type}
          campaign={campaign}
          campaignPlanDueDate={flow.due}
          onClose={() => setFlow(null)}
        />
      )}
      <ProUpgradeModal
        {...{
          variant: VARIANTS.Second_NonViable,
          open: showProUpgradeModal,
          onClose: () => setShowProUpgradeModal(false),
        }}
      />
      {gateModals}
    </>
  )

  return { open, flowNode }
}
