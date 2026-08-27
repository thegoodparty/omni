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
import { useVoterOutreachV2SmsFlag } from '@shared/experiments/voterOutreachV2SmsFlag'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'
import type { OutreachType } from 'gpApi/types/outreach.types'
import {
  PRO_UPGRADE_BASE_PATH,
  PRO_UPGRADE_TAKEOVER_SRC,
} from 'app/dashboard/pro-upgrade/proUpgradeStep'
import { CHANNEL_META } from './channelMeta'

// Outreach entries open the Pro upgrade wizard in its takeover chrome
// (?src=outreach — see ProUpgradeWizard's fork).
const PRO_UPGRADE_TAKEOVER_ENTRY = `${PRO_UPGRADE_BASE_PATH}?src=${PRO_UPGRADE_TAKEOVER_SRC}`

interface ChannelTileGridProps {
  tcrCompliance?: TcrCompliance
  preselectedListId?: number
  onCreateSocial: () => void
  onCreateSms: () => void
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
  onCreateSms,
  onCreateRobocall,
  onCreatePhoneBanking,
}: ChannelTileGridProps) => {
  const router = useRouter()
  const [campaign] = useCampaign()
  const { isPro } = campaign || {}
  const [flowType, setFlowType] = useState<OutreachType | null>(null)
  const [showProUpgradeModal, setShowProUpgradeModal] = useState(false)
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance)
  // Each tile is its own divergence point: flag on opens the new flow,
  // off (or unsettled) launches the legacy TaskFlow — the same fallback
  // shape every channel gets until its phase swaps the tile target.
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
  // The SMS tile's own swap, checked after the text gate passes.
  const smsV2 = useVoterOutreachV2SmsFlag()

  // Consume-once preselected list (ENG-10762 conventions, mirrored from
  // OutreachCreateCards): the deep-link strip's router.replace re-runs the
  // force-dynamic page's server render without ?listId, reverting the prop to
  // undefined — state on this instance survives that pass. Cleared as soon as
  // a consuming flow has taken it, so a later-opened flow starts clean: on
  // close for the flows that open here, on navigation for door knocking,
  // which applies it on the page it goes to. The ref tracks the last PROP
  // value already pulled in so clearing can't get re-synced back from an
  // unchanged prop.
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
      if (smsV2.ready && smsV2.enabled) {
        // Upgrade-at-entry with the takeover chrome (design parity): a
        // non-Pro click goes straight into the Pro upgrade takeover instead
        // of the legacy marketing modal. Same population the text gate's
        // isPro branch caught — only the destination changed. The compliance
        // branch (Pro, not approved) still runs through the gate's modal.
        if (!isPro) {
          trackEvent(EVENTS.ProUpgrade.Compliance.LockedItemClicked, { type })
          router.push(PRO_UPGRADE_TAKEOVER_ENTRY)
          return
        }
        if (!runTextGate()) return
        onCreateSms()
        return
      }
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
        router.push(PRO_UPGRADE_TAKEOVER_ENTRY)
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
      // The one tile that navigates instead of opening a flow here, so the
      // preselected list travels as `?listId=` — the same param the CRM's
      // "Send outreach" links already use to reach this hub. The
      // door-knocking page parses it with the same positive-integer rule and
      // ignores anything else, so a stale id costs the preselection and
      // nothing more.
      //
      // Consumed on the way out, exactly as the flows that close do it: this
      // channel is now one of the ones that APPLIES the preselect, and the
      // instance can outlive the navigation in the App Router's soft-nav
      // cache. Left set, a Back to this hub would hand the same id to
      // whichever tile was pressed next — a text campaign silently aimed at a
      // list the candidate chose for a walk.
      const listId = pendingPreselectedListId
      setPendingPreselectedListId(undefined)
      lastSyncedPropListIdRef.current = undefined
      router.push(
        listId === undefined
          ? '/dashboard/door-knocking'
          : `/dashboard/door-knocking?listId=${listId}`,
      )
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
                (type === OUTREACH_TYPES.phoneBanking &&
                phoneBankingV2.ready &&
                phoneBankingV2.enabled
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
            // carries it away in the URL instead of opening TaskFlow here).
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
