'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import type { OutreachType } from 'gpApi/types/outreach.types'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import { ProUpgradeModal, VARIANTS } from 'app/dashboard/shared/ProUpgradeModal'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import { parseRecommendedListVariant } from 'app/dashboard/outreach/util/parseRecommendedListVariant.util'
import type { RecommendedListVariant } from '@goodparty_org/contracts'
import type { ComposeSource } from 'app/dashboard/outreach/util/composeOutreachHref.util'
import type { TcrCompliance } from 'helpers/types'

// What a `?compose=` deep link asks the hub to open, once the channel's gate
// has passed. The hub owns the flow mounts (one instance each), so this
// component resolves the params and the gates and then hands the seeds over —
// it renders no flow of its own.
export interface ComposeRequest {
  type: OutreachType
  // Text only: a message meant to be sent as written (Know Your Opponent's
  // suggested SMS). Robocall's deliverable is a recording, so it seeds none.
  script?: string
  due?: string
  listId?: number
  // A voter data page recommendation not saved yet (`?recommended=`), which
  // the flow's audience step saves on arrival.
  recommendedVariant?: RecommendedListVariant
}

interface OutreachComposeDeepLinkProps {
  tcrCompliance?: TcrCompliance
  onCompose: (request: ComposeRequest) => void
}

// Deep-linkable compose types. The Campaign Tracker and Campaign Manager link
// their text/robocall tasks here so the flow opens with the task's due date
// attached (the due date rides the outreach record into the Slack
// notification). The voter data page's channel picker opens every flow the
// same way, so phone banking and social are reachable too.
const COMPOSE_TYPES: Record<string, OutreachType> = {
  text: OUTREACH_TYPES.text,
  robocall: OUTREACH_TYPES.robocall,
  phoneBanking: OUTREACH_TYPES.phoneBanking,
  social: OUTREACH_TYPES.socialMedia,
}

const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Where the link was pressed, for `ClickCreate` and the text gate's own
// events. Allowlisted rather than passed through, so the query string cannot
// inject an arbitrary value into analytics; anything else reads as a plain
// deep link.
const COMPOSE_SOURCES: ComposeSource[] = [
  'campaign_manager',
  'campaign_tracker',
  'voter_data',
]
const parseComposeSource = (value: string | null | undefined): string =>
  COMPOSE_SOURCES.includes(value as ComposeSource)
    ? (value as string)
    : 'deep_link'

export const OutreachComposeDeepLink = ({
  tcrCompliance,
  onCompose,
}: OutreachComposeDeepLinkProps): React.JSX.Element => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [campaign] = useCampaign()
  const composeSource = parseComposeSource(searchParams?.get('source'))
  const { runTextGate, gateModals } = useTextOutreachGate(
    tcrCompliance,
    composeSource,
  )
  const [showProUpgradeModal, setShowProUpgradeModal] = useState(false)
  const consumedRef = useRef(false)
  const bareParamConsumedRef = useRef(false)

  const composeType = COMPOSE_TYPES[searchParams?.get('compose') ?? '']
  const listIdParam = searchParams?.get('listId')
  // `?recommended=` is the voter data page's other arrival: a recommendation
  // not saved yet, read server-side the same way listId is.
  const bareAudienceParam = listIdParam || searchParams?.get('recommended')
  // ENG-10762 (delegate follow-up): when compose and listId arrive together,
  // this component resolves the preselected list itself and hands it to the
  // hub with the rest of the seeds, rather than relying on the
  // server-threaded prop the channel tiles read.
  const preselectedListId = parsePositiveListId(listIdParam)
  const recommendedVariant = parseRecommendedListVariant(
    searchParams?.get('recommended'),
  )

  // ENG-10762: the CRM "Send outreach" link carries ?listId=<id> so the
  // server (page.tsx) can read it and thread preselectedListId down to the
  // audience step. Once consumed server-side there's nothing left for the
  // param to do client-side, so strip it from the address bar the same way
  // `compose` is stripped. When `compose` is also present, its own
  // router.replace already clears the whole query string (including
  // listId) — skip here so the two effects don't race on the same replace.
  useEffect(() => {
    // Re-arm when the param goes absent (post-strip), same as consumedRef
    // below, so a second ?listId= navigation while mounted still strips.
    if (!bareAudienceParam) {
      bareParamConsumedRef.current = false
      return
    }
    if (composeType || bareParamConsumedRef.current) return
    bareParamConsumedRef.current = true
    router.replace('/dashboard/outreach', { scroll: false })
  }, [bareAudienceParam, composeType, router])

  useEffect(() => {
    // Once router.replace strips the params, composeType goes falsy: re-arm
    // the guard so a later deep link (from a tracker task clicked while this
    // page stays mounted — same route, new params) opens a fresh flow. The
    // ref only guards the async window between replace() and the params
    // actually updating.
    if (!composeType) {
      consumedRef.current = false
      return
    }
    if (consumedRef.current || !campaign) return
    consumedRef.current = true
    // Clamp to the same limit the composer enforces, so an over-long preset
    // arrives already trimmed rather than blocking Continue on arrival.
    const message = (searchParams?.get('message') || '').slice(
      0,
      P2P_SCRIPT_MAX_LENGTH,
    )
    const dueParam = searchParams?.get('due') || ''
    const due = DUE_DATE_RE.test(dueParam) ? dueParam : undefined
    router.replace('/dashboard/outreach', { scroll: false })
    trackEvent(EVENTS.Outreach.ClickCreate, {
      type: composeType,
      source: composeSource,
    })
    if (composeType === OUTREACH_TYPES.text) {
      if (runTextGate()) {
        onCompose({
          type: composeType,
          script: message || undefined,
          due,
          listId: preselectedListId,
          recommendedVariant,
        })
      }
      return
    }
    // Social has no gate and no audience: unlocked for everyone, like its
    // tile.
    if (composeType === OUTREACH_TYPES.socialMedia) {
      onCompose({ type: composeType })
      return
    }
    // Phone banking's upgrade-at-entry, exactly as its tile does it: the Pro
    // upgrade wizard rather than a modal.
    if (composeType === OUTREACH_TYPES.phoneBanking) {
      if (!campaign.isPro) {
        trackEvent(EVENTS.ProUpgrade.Compliance.LockedItemClicked, {
          type: composeType,
        })
        router.push('/dashboard/pro-upgrade')
        return
      }
      onCompose({
        type: composeType,
        listId: preselectedListId,
        recommendedVariant,
      })
      return
    }
    // Robocall is Pro-gated the same way the outreach create cards gate it.
    if (!campaign.isPro) {
      trackEvent(EVENTS.Outreach.P2PCompliance.ComplianceStarted, {
        source: composeSource,
      })
      setShowProUpgradeModal(true)
      return
    }
    onCompose({
      type: composeType,
      due,
      listId: preselectedListId,
      recommendedVariant,
    })
  }, [
    composeType,
    campaign,
    searchParams,
    router,
    runTextGate,
    preselectedListId,
    recommendedVariant,
    onCompose,
    composeSource,
  ])

  return (
    <>
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
}
