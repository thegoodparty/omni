'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ChannelCard } from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import {
  OUTREACH_OPTIONS,
  OUTREACH_TYPES,
} from 'app/dashboard/outreach/constants'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import { useNativeDoorKnockingFlag } from '@shared/experiments/nativeDoorKnockingFlag'
import { useOutreachProGatingV2Flag } from 'app/shared/experiments/outreachProGatingV2Flag'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'
import type { OutreachType } from 'gpApi/types/outreach.types'
import type { RecommendedListVariant } from '@goodparty_org/contracts'
import { voterPackQueryOptions } from 'app/dashboard/door-knocking/native/useVoterPack'
import { CHANNEL_META } from './channelMeta'
import type { AudiencePreselect } from './audiencePreselect'

interface ChannelTileGridProps {
  tcrCompliance?: TcrCompliance
  // `?listId=` / `?recommended=` off the voter data page, one or the other.
  preselectedListId?: number
  preselectedRecommendedVariant?: RecommendedListVariant
  onCreateSocial: () => void
  // Every audience-taking tile receives the carried audience on open; a
  // channel that does not spend it (social) takes no argument.
  onCreateSms: (preselect?: AudiencePreselect) => void
  onCreateRobocall: (preselect?: AudiencePreselect) => void
  onCreatePhoneBanking: (preselect?: AudiencePreselect) => void
}

const toPreselect = (
  listId: number | undefined,
  recommendedVariant: RecommendedListVariant | undefined,
): AudiencePreselect | undefined =>
  listId !== undefined
    ? { listId }
    : recommendedVariant !== undefined
      ? { recommendedVariant }
      : undefined

// One string per distinct arrival, so the prop-sync below can tell "the same
// arrival, re-rendered" from "a new deep link while mounted".
const preselectKey = (
  listId: number | undefined,
  recommendedVariant: RecommendedListVariant | undefined,
): string => `${listId ?? ''}|${recommendedVariant ?? ''}`

// Hub tile order: social first (unlocked for everyone), then the Pro-locked
// channels. Pricing sub-copy comes from OUTREACH_OPTIONS until phase 2 moves
// pricing server-side.
const TILE_ORDER: OutreachType[] = [
  OUTREACH_TYPES.socialMedia,
  OUTREACH_TYPES.text,
  OUTREACH_TYPES.robocall,
  OUTREACH_TYPES.phoneBanking,
  OUTREACH_TYPES.doorKnocking,
]

export const ChannelTileGrid = ({
  tcrCompliance,
  preselectedListId,
  preselectedRecommendedVariant,
  onCreateSocial,
  onCreateSms,
  onCreateRobocall,
  onCreatePhoneBanking,
}: ChannelTileGridProps) => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [campaign] = useCampaign()
  const { isPro } = campaign || {}
  const [showProUpgradeModal, setShowProUpgradeModal] = useState(false)
  const { runTextGate, gateModals } = useTextOutreachGate(tcrCompliance)
  // Milestone 2 moves the Pro/compliance gate INSIDE the text, robocall and
  // phone-banking flows: the tile stops refusing the click and opens the
  // flow, which pauses itself once there is something to save. Read without
  // exposure — pressing a tile is not the treatment surface.
  const { enabled: gatedFlows } = useOutreachProGatingV2Flag(false)
  // Read only to decide whether the district download below is worth starting.
  // The door-knocking page gate is the treatment surface, so no exposure here.
  const nativeDoorKnocking = useNativeDoorKnockingFlag(false)
  // Own equivalent of ContactsTableProvider's canUseProFeatures — not
  // imported from there (contacts-scoped, would force an organization
  // provider onto every tile-grid test). A pending elected-office query must
  // NOT read as a refusal, or a Serve org's first render redirects to
  // pro-upgrade before its own entitlement resolves. Backs the phone-banking
  // tile's upgrade-at-entry: a non-Pro click redirects straight to
  // /dashboard/pro-upgrade (ENG-10920) instead of the legacy Pro modal.
  const { data: electedOffice, isPending: electedOfficePending } =
    useElectedOffice()
  const canUseProFeatures = !!isPro || !!electedOffice

  // Consume-once preselected audience (ENG-10762 conventions): the deep-link
  // strip's router.replace re-runs the force-dynamic page's server render
  // without the param, reverting the props to undefined — state on this
  // instance survives that pass. Spent as soon as a consuming channel has
  // taken it, so a later-opened flow starts clean: on hand-off for the flows
  // the hub mounts, on navigation for door knocking, which applies it on the
  // page it goes to. Every audience-taking tile spends it; social alone has
  // no audience and leaves it for the next tile. The ref tracks the last PROP
  // arrival already pulled in so spending can't get re-synced back from an
  // unchanged prop.
  const [pendingPreselect, setPendingPreselect] = useState(
    toPreselect(preselectedListId, preselectedRecommendedVariant),
  )
  const lastSyncedPreselectKeyRef = useRef(
    preselectKey(preselectedListId, preselectedRecommendedVariant),
  )
  useEffect(() => {
    const next = toPreselect(preselectedListId, preselectedRecommendedVariant)
    const key = preselectKey(preselectedListId, preselectedRecommendedVariant)
    if (next !== undefined && key !== lastSyncedPreselectKeyRef.current) {
      lastSyncedPreselectKeyRef.current = key
      setPendingPreselect(next)
    }
  }, [preselectedListId, preselectedRecommendedVariant])
  const spendPreselect = (): AudiencePreselect | undefined => {
    const spent = pendingPreselect
    setPendingPreselect(undefined)
    lastSyncedPreselectKeyRef.current = preselectKey(undefined, undefined)
    return spent
  }

  const handleTileClick = (type: OutreachType, requiresPro?: boolean) => {
    trackEvent(EVENTS.Outreach.ClickCreate, { type })

    if (type === OUTREACH_TYPES.socialMedia) {
      onCreateSocial()
      return
    }
    if (type === OUTREACH_TYPES.text) {
      if (gatedFlows) {
        onCreateSms(spendPreselect())
        return
      }
      // Upgrade-at-entry (2026-08-28): a non-Pro click goes straight to the
      // Pro upgrade wizard instead of the legacy marketing modal, the same
      // pattern the phone-banking tile set. Pro candidates with an
      // unfinished registration run through the gate's status-aware
      // ComplianceModal below (legacy semantics: approved passes).
      if (!isPro) {
        trackEvent(EVENTS.ProUpgrade.Compliance.LockedItemClicked, { type })
        router.push('/dashboard/pro-upgrade')
        return
      }
      if (!runTextGate()) return
      // Spent only once the gate has passed: a candidate sent to the
      // compliance modal never entered the flow, so the carried audience must
      // survive for whichever tile they press after coming back.
      onCreateSms(spendPreselect())
      return
    }
    if (type === OUTREACH_TYPES.phoneBanking) {
      // A pending elected-office query is not a refusal — wait for it to
      // settle rather than redirecting a Serve org that will resolve true.
      if (!gatedFlows && !canUseProFeatures && !electedOfficePending) {
        trackEvent(EVENTS.ProUpgrade.Compliance.LockedItemClicked, { type })
        router.push('/dashboard/pro-upgrade')
        return
      }
      // Consumed on hand-off, like door knocking: PhoneBankingFlow is
      // mounted by the hub, not here, so the audience travels through the
      // open callback — and spending it now is what keeps a later SMS/robocall
      // tile click from inheriting a list chosen for phone banking. The
      // Pro-redirect above deliberately does NOT spend it: the candidate
      // never entered the flow, so the deep-linked audience must survive for
      // whichever tile they press after coming back.
      onCreatePhoneBanking(spendPreselect())
      return
    }

    if (type === OUTREACH_TYPES.robocall) {
      if (!gatedFlows && requiresPro && !isPro) {
        trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceStarted, {
          source: 'outreach_page',
        })
        setShowProUpgradeModal(true)
        return
      }
      onCreateRobocall(spendPreselect())
      return
    }
    // Behind the flag door knocking is a door like the other three: its page
    // admits a free campaign (the map's reads are open to one) and its create
    // flow gates Build route, the one paid write.
    if (!gatedFlows && requiresPro && !isPro) {
      trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceStarted, {
        source: 'outreach_page',
      })
      setShowProUpgradeModal(true)
      return
    }
    if (type === OUTREACH_TYPES.doorKnocking) {
      // The one tile that navigates instead of opening a flow here, so the
      // preselected audience travels in the URL — `?listId=` or
      // `?recommended=`, the same params the voter data page's "Send
      // outreach" links use to reach this hub. The door-knocking page parses
      // them with the same rules and ignores anything else, so a stale value
      // costs the preselection and nothing more.
      //
      // `?create=1` because this tile asks to START a walk, not to look at
      // the map. Landing on the rail and making the candidate find Create
      // list was a step the other channels don't charge — pressing Email
      // opens the email flow, so pressing Door knocking opens this one.
      //
      // Consumed on the way out, exactly as the flows that close do it: this
      // channel is now one of the ones that APPLIES the preselect, and the
      // instance can outlive the navigation in the App Router's soft-nav
      // cache. Left set, a Back to this hub would hand the same id to
      // whichever tile was pressed next — a text campaign silently aimed at a
      // list the candidate chose for a walk.
      const preselect = spendPreselect()
      // Start the district download here rather than on the far side of the
      // navigation. The pack is the slowest read the product has (p50 4.5s,
      // p95 33.6s in prod) and everything the create flow counts is derived
      // from it, so every millisecond it can be given ahead of the first step
      // is a millisecond the candidate does not spend on a dead Continue. The
      // route transition and the map chunk are that head start; the flow's own
      // purpose and who steps are the rest of it.
      //
      // Prefetch and not fetch: a district this org cannot resolve answers 400
      // and the page's own `isUnresolvable` branch already speaks for that
      // case, so a rejection here must not surface as anything.
      //
      // Only for the arm that lands on the native page. A control-arm campaign
      // gets the eCanvasser dashboard, which has no pack in it, and tens of
      // megabytes of district for a map they will never be shown is a worse
      // deal than the dead Continue this exists to avoid. The flag is read
      // without exposure here — pressing a tile is not the treatment.
      if (nativeDoorKnocking.enabled) {
        void queryClient.prefetchQuery(voterPackQueryOptions)
      }
      router.push(
        preselect?.listId !== undefined
          ? `/dashboard/door-knocking?create=1&listId=${preselect.listId}`
          : preselect?.recommendedVariant !== undefined
            ? `/dashboard/door-knocking?create=1&recommended=${preselect.recommendedVariant}`
            : '/dashboard/door-knocking?create=1',
      )
      return
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Create a campaign
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick a channel to draft and send a new campaign.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {TILE_ORDER.map((type) => {
          const option = OUTREACH_OPTIONS.find((o) => o.type === type)
          const meta = CHANNEL_META[type]
          // The four channels whose flows carry their own gate: the tile is
          // a door now, not a lock.
          const gatedInFlow =
            gatedFlows &&
            (type === OUTREACH_TYPES.text ||
              type === OUTREACH_TYPES.robocall ||
              type === OUTREACH_TYPES.phoneBanking ||
              type === OUTREACH_TYPES.doorKnocking)
          return (
            <ChannelCard
              key={type}
              icon={meta.icon}
              iconClassName={meta.iconTint}
              label={meta.label}
              locked={
                !gatedInFlow &&
                Boolean(
                  option?.requiresPro &&
                  (type === OUTREACH_TYPES.phoneBanking
                    ? !canUseProFeatures && !electedOfficePending
                    : !isPro),
                )
              }
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
    </section>
  )
}
