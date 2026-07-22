'use client'
import { OutreachCreateCard } from './OutreachCreateCard'
import {
  IMPACTS_LEVELS,
  OUTREACH_TYPES,
} from 'app/dashboard/outreach/constants'
import TaskFlow from 'app/dashboard/components/tasks/flows/TaskFlow'
import { useEffect, useRef, useState } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import type { TcrCompliance } from 'helpers/types'
import type { OutreachType } from 'gpApi/types/outreach.types'

interface OutreachCreateCardsProps {
  tcrCompliance?: TcrCompliance
  preselectedListId?: number
}

interface FlowModalTask {
  flowType: OutreachType
}

interface OutreachOption {
  title: string
  impact: 'low' | 'medium' | 'high'
  cost: number
  type: OutreachType
  requiresPro?: boolean
}

export const OUTREACH_OPTIONS: OutreachOption[] = [
  {
    title: 'Text message',
    impact: IMPACTS_LEVELS.medium,
    cost: 0.035,
    type: OUTREACH_TYPES.text,
    requiresPro: true,
  },
  {
    title: 'Robocall',
    impact: IMPACTS_LEVELS.medium,
    cost: 0.045,
    type: OUTREACH_TYPES.robocall,
    requiresPro: true,
  },
  {
    title: 'Door knocking',
    impact: IMPACTS_LEVELS.high,
    cost: 0,
    type: OUTREACH_TYPES.doorKnocking,
    requiresPro: true,
  },
  {
    title: 'Phone banking',
    impact: IMPACTS_LEVELS.medium,
    cost: 0,
    type: OUTREACH_TYPES.phoneBanking,
    requiresPro: true,
  },
  {
    title: 'Social post',
    impact: IMPACTS_LEVELS.low,
    cost: 0,
    type: OUTREACH_TYPES.socialMedia,
  },
]

const OutreachCreateCards = ({
  tcrCompliance,
  preselectedListId,
}: OutreachCreateCardsProps): React.JSX.Element => {
  const [campaign] = useCampaign()
  const { isPro } = campaign || {}
  const [flowModalTask, setFlowModalTask] = useState<FlowModalTask | null>(null)
  const [showProUpgradeModal, setShowProUpgradeModal] = useState(false)
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance)

  // ENG-10762 (Bugbot follow-up): mirrors `preselectedListId` into state that
  // survives OutreachComposeDeepLink's listId-strip (its router.replace
  // re-fetches the force-dynamic outreach page's RSC payload without
  // ?listId, so the prop reverts to undefined on that pass — this component
  // instance's own state doesn't). Consume-once: cleared as soon as the
  // TaskFlow that carried it closes, so a later-opened flow (any card)
  // starts clean instead of inheriting a stale preselect. A later deep link
  // that updates the id while this component stays mounted still applies.
  // `lastSyncedPropListIdRef` tracks the last PROP value already pulled in —
  // not the (post-close) pending state — so clearing pending on close can't
  // immediately get re-synced back from an unchanged prop.
  // ENG-10764: robocall's AudienceStep now applies preselectedListId too, so
  // closing a robocall flow must also consume it — see `isConsumingFlow`.
  const [pendingPreselectedListId, setPendingPreselectedListId] =
    useState(preselectedListId)
  const lastSyncedPropListIdRef = useRef(preselectedListId)
  useEffect(() => {
    if (
      preselectedListId !== undefined &&
      preselectedListId !== lastSyncedPropListIdRef.current
    ) {
      lastSyncedPropListIdRef.current = preselectedListId
      setPendingPreselectedListId(preselectedListId)
    }
  }, [preselectedListId])

  const openProUpgradeModal = () => {
    setShowProUpgradeModal(true)
  }

  const openTaskFlow = (type: OutreachType) =>
    setFlowModalTask({
      flowType: type,
    })

  const handleCreateClick = (requiresPro?: boolean) => (type: OutreachType) => {
    trackEvent(EVENTS.Outreach.ClickCreate, { type })

    if (type === OUTREACH_TYPES.text) {
      if (!runTextGate()) {
        return
      }
    } else if (requiresPro && !isPro) {
      trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceStarted, {
        source: 'outreach_page',
      })
      return openProUpgradeModal()
    }

    return openTaskFlow(type)
  }

  return (
    <div
      className="
        w-full
        grid
        grid-cols-2
        sm:grid-cols-2
        md:grid-cols-3
        lg:grid-cols-3
        xl:grid-cols-5
        gap-4
        md:gap-6
        justify-center
        lg:bg-gray-200
        rounded-2xl
        p-0
        lg:p-6
        mb-12
      "
    >
      {OUTREACH_OPTIONS.map(({ title, impact, cost, type, requiresPro }) => (
        <OutreachCreateCard
          key={type}
          {...{
            type,
            title,
            impact,
            cost,
            onClick: handleCreateClick(requiresPro),
            requiresPro,
          }}
        />
      ))}
      <ProUpgradeModal
        {...{
          variant: VARIANTS.Second_NonViable,
          open: showProUpgradeModal,
          onClose: () => setShowProUpgradeModal(false),
        }}
      />

      {gateModals}

      {flowModalTask && campaign && (
        <TaskFlow
          forceOpen
          type={flowModalTask.flowType}
          campaign={campaign}
          preselectedListId={pendingPreselectedListId}
          onClose={() => {
            // ENG-10764: robocall's AudienceStep now applies the preselect
            // too, so it must consume it on close the same as text — door
            // knocking/phone banking still pass it through untouched.
            const isConsumingFlow =
              flowModalTask.flowType === OUTREACH_TYPES.text ||
              flowModalTask.flowType === OUTREACH_TYPES.robocall
            setFlowModalTask(null)
            // Consume-once, but only flows whose audience step actually
            // applies the id — closing a non-consuming flow must not burn
            // it. Reset the ref too so a later deep link re-firing the
            // identical id re-syncs.
            if (isConsumingFlow) {
              setPendingPreselectedListId(undefined)
              lastSyncedPropListIdRef.current = undefined
            }
          }}
        />
      )}
    </div>
  )
}

export default OutreachCreateCards
