'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChannelCard } from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import TaskFlow from 'app/dashboard/components/tasks/flows/TaskFlow'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/components/OutreachCreateCards'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import { useVoterOutreachV2SocialFlag } from '@shared/experiments/voterOutreachV2SocialFlag'
import { useVoterOutreachV2RobocallFlag } from '@shared/experiments/voterOutreachV2RobocallFlag'
import { useVoterOutreachV2PhoneBankingFlag } from '@shared/experiments/voterOutreachV2PhoneBankingFlag'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'
import type { OutreachType } from 'gpApi/types/outreach.types'
import { CHANNEL_META } from './channelMeta'

interface ChannelTileGridProps {
  tcrCompliance?: TcrCompliance
  preselectedListId?: number
  onCreateSocial: () => void
  onCreateRobocall: () => void
  onCreatePhoneBanking: () => void
}

// Hub tile order: social first (unlocked for everyone), then the Pro-locked
// legacy channels. Pricing sub-copy comes from the same OUTREACH_OPTIONS
// constants the legacy cards read, until phase 2 moves pricing server-side.
const TILE_ORDER: OutreachType[] = [
  OUTREACH_TYPES.socialMedia,
  OUTREACH_TYPES.text,
  OUTREACH_TYPES.robocall,
  OUTREACH_TYPES.phoneBanking,
  OUTREACH_TYPES.doorKnocking,
]

const formatCost = (cost: number): string =>
  cost === 0 ? 'Free' : `$${cost.toFixed(3).replace(/^0\./, '.')}/msg`

export const ChannelTileGrid = ({
  tcrCompliance,
  preselectedListId,
  onCreateSocial,
  onCreateRobocall,
  onCreatePhoneBanking,
}: ChannelTileGridProps) => {
  const router = useRouter()
  const [campaign] = useCampaign()
  const { isPro } = campaign || {}
  const [flowType, setFlowType] = useState<OutreachType | null>(null)
  const [showProUpgradeModal, setShowProUpgradeModal] = useState(false)
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance)
  // The social tile is its own divergence point: flag on opens the new
  // social flow, off (or unsettled) launches the legacy socialMedia
  // TaskFlow — the same fallback shape every other channel gets until its
  // phase swaps the tile target.
  const socialV2 = useVoterOutreachV2SocialFlag()
  // The robocall tile's own swap: flag on opens the new robocall flow, off
  // (or unsettled) falls through to the legacy robocall TaskFlow — same shape
  // as the social swap, but checked after the Pro gate since robocall is
  // Pro-locked.
  const robocallV2 = useVoterOutreachV2RobocallFlag()
  // The phone-banking tile's own swap. Unlike social/robocall, flag-on ALSO
  // changes the Pro gate: a non-Pro click redirects straight to
  // /dashboard/pro-upgrade instead of the legacy Pro modal (upgrade-at-entry,
  // ENG-10920) — flag off/unsettled keeps the legacy TaskFlow + Pro modal
  // byte-identical.
  const phoneBankingV2 = useVoterOutreachV2PhoneBankingFlag()
  // Own equivalent of ContactsTableProvider's canUseProFeatures — not
  // imported from there (contacts-scoped, would force an organization
  // provider onto every tile-grid test). A pending elected-office query must
  // NOT read as a refusal, or a Serve org's first render redirects to
  // pro-upgrade before its own entitlement resolves.
  const { data: electedOffice, isPending: electedOfficePending } =
    useElectedOffice()
  const canUseProFeatures = !!isPro || !!electedOffice

  // Consume-once preselected list (ENG-10762 conventions, mirrored from
  // OutreachCreateCards): the deep-link strip's router.replace re-runs the
  // force-dynamic page's server render without ?listId, reverting the prop to
  // undefined — state on this instance survives that pass. Cleared as soon as
  // a consuming flow closes so a later-opened flow starts clean; the ref
  // tracks the last PROP value already pulled in so clearing on close can't
  // get re-synced back from an unchanged prop.
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

  const handleTileClick = (type: OutreachType, requiresPro?: boolean) => {
    trackEvent(EVENTS.Outreach.ClickCreate, { type })

    if (type === OUTREACH_TYPES.socialMedia) {
      if (socialV2.ready && socialV2.enabled) {
        onCreateSocial()
        return
      }
      setFlowType(type)
      return
    }
    if (type === OUTREACH_TYPES.text) {
      if (!runTextGate()) return
      setFlowType(type)
      return
    }
    if (
      type === OUTREACH_TYPES.phoneBanking &&
      phoneBankingV2.ready &&
      phoneBankingV2.enabled
    ) {
      // A pending elected-office query is not a refusal — wait for it to
      // settle rather than redirecting a Serve org that will resolve true.
      if (!canUseProFeatures && !electedOfficePending) {
        trackEvent(EVENTS.ProUpgrade.Compliance.LockedItemClicked, { type })
        router.push('/dashboard/pro-upgrade')
        return
      }
      onCreatePhoneBanking()
      return
    }

    if (requiresPro && !isPro) {
      trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceStarted, {
        source: 'outreach_page',
      })
      setShowProUpgradeModal(true)
      return
    }
    if (
      type === OUTREACH_TYPES.robocall &&
      robocallV2.ready &&
      robocallV2.enabled
    ) {
      onCreateRobocall()
      return
    }
    if (type === OUTREACH_TYPES.doorKnocking) {
      router.push('/dashboard/door-knocking')
      return
    }
    setFlowType(type)
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Create an outreach campaign
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick a channel to draft and send a new campaign.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {TILE_ORDER.map((type) => {
          const option = OUTREACH_OPTIONS.find((o) => o.type === type)
          const meta = CHANNEL_META[type]
          return (
            <ChannelCard
              key={type}
              icon={meta.icon}
              iconClassName={meta.iconTint}
              label={meta.label}
              subCopy={formatCost(option?.cost ?? 0)}
              locked={Boolean(
                option?.requiresPro &&
                (type === OUTREACH_TYPES.phoneBanking
                  ? !canUseProFeatures && !electedOfficePending
                  : !isPro),
              )}
              onClick={() => handleTileClick(type, option?.requiresPro)}
            />
          )
        })}
      </div>
      <ProUpgradeModal
        {...{
          variant: VARIANTS.Second_NonViable,
          open: showProUpgradeModal,
          onClose: () => setShowProUpgradeModal(false),
        }}
      />
      {gateModals}
      {flowType && campaign && (
        <TaskFlow
          forceOpen
          type={flowType}
          campaign={campaign}
          preselectedListId={pendingPreselectedListId}
          onClose={() => {
            // Only flows whose audience step applies the preselect consume
            // it on close (text/robocall/phoneBanking — door knocking
            // navigates away instead of opening TaskFlow here).
            const isConsumingFlow =
              flowType === OUTREACH_TYPES.text ||
              flowType === OUTREACH_TYPES.robocall ||
              flowType === OUTREACH_TYPES.phoneBanking
            setFlowType(null)
            if (isConsumingFlow) {
              setPendingPreselectedListId(undefined)
              lastSyncedPropListIdRef.current = undefined
            }
          }}
        />
      )}
    </section>
  )
}
