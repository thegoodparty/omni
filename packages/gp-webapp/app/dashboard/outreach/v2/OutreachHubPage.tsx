'use client'

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NAV_LABELS } from 'app/dashboard/shared/navLabels'
import {
  OutreachProvider,
  useOutreach,
  type Outreach,
} from 'app/dashboard/outreach/hooks/OutreachContext'
import {
  OutreachComposeDeepLink,
  type ComposeRequest,
} from 'app/dashboard/outreach/components/OutreachComposeDeepLink'
import { clientRequest } from 'gpApi/typed-request'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import type { OutreachType } from 'gpApi/types/outreach.types'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSingleEffect } from '@shared/hooks/useSingleEffect'
import { useMembershipState } from 'app/dashboard/shared/membership/useMembershipState'
import { useOutreachProGatingV2Flag } from 'app/shared/experiments/outreachProGatingV2Flag'
import type { Campaign, TcrCompliance } from 'helpers/types'
import type {
  OutreachDetail,
  RecommendedListVariant,
} from '@goodparty_org/contracts'
import { ChannelTileGrid } from './ChannelTileGrid'
import { OutreachHistoryTable } from './OutreachHistoryTable'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import { SocialFlow } from './social/SocialFlow'
import { RobocallFlow } from './robocall/RobocallFlow'
import { PhoneBankingFlow } from './phone-banking/PhoneBankingFlow'
import { SmsFlow } from './sms/SmsFlow'
import { fetchOutreachDetail, useSeedOutreachDetail } from './useOutreachDetail'
import type { HistoryRow } from './historyStatus.util'
import type { AudiencePreselect } from './audiencePreselect'
import { DRAFT_FOOTER_LABELS } from './listDetails/footerMode'
import type { OutreachFlowSource } from 'app/dashboard/outreach/util/outreachAnalytics'
import { flowSourceFromCompose } from 'app/dashboard/outreach/util/composeOutreachHref.util'

// The two channels that can hold a saved draft, and the row types that
// resume into each. A draft row is the campaign's way back into the flow
// that saved it.
type DraftChannel = 'text' | 'robocall'
const DRAFT_CHANNELS: Partial<Record<string, DraftChannel>> = {
  text: 'text',
  p2p: 'text',
  robocall: 'robocall',
}

// Analytics reports the gate's channel vocabulary, so the hub's own name
// for the text channel is translated rather than reported as a third one.
const GATE_CHANNEL: Record<DraftChannel, string> = {
  text: 'sms',
  robocall: 'robocall',
}

// Where the resume was pressed: the channel tile, a draft row in the
// history, or a `?compose=` arrival.
type ResumeSource = 'tile' | 'row' | 'deep_link'

export interface OutreachHubPageProps {
  pathname: string
  campaign: Campaign
  outreaches?: Outreach[]
  tcrCompliance?: TcrCompliance
  preselectedListId?: number
  // ?recommended= off a voter data page recommended card: a recommendation
  // not saved yet, which the chosen flow's audience step saves.
  preselectedRecommendedVariant?: RecommendedListVariant
  // ?outreachId= deep link (activity feed "View outreach"): in the v2 hub it
  // opens the details drawer instead of highlighting a table row.
  initialOutreachId?: number
}

const OutreachHubContent = ({
  tcrCompliance,
  preselectedListId,
  preselectedRecommendedVariant,
  initialOutreachId,
}: Pick<
  OutreachHubPageProps,
  | 'tcrCompliance'
  | 'preselectedListId'
  | 'preselectedRecommendedVariant'
  | 'initialOutreachId'
>) => {
  const router = useRouter()
  const [outreaches, setOutreaches] = useOutreach()
  // A draft outreach can't send yet — behind the flag, a candidate must
  // never see the row at all (today's behavior), and the membership read it
  // would take to label one stays idle (`enabled`) rather than paying for a
  // TCR read no UI here will use.
  const { enabled: draftsEnabled } = useOutreachProGatingV2Flag(false)
  const { state: membership } = useMembershipState({ enabled: draftsEnabled })
  const historyRows = useMemo(
    () =>
      draftsEnabled
        ? (outreaches ?? [])
        : (outreaches ?? []).filter((o) => o.status !== 'draft'),
    [draftsEnabled, outreaches],
  )
  const [detailsRow, setDetailsRow] = useState<HistoryRow | null>(null)
  const [socialFlowOpen, setSocialFlowOpen] = useState(false)
  const [robocallFlowOpen, setRobocallFlowOpen] = useState(false)
  const [phoneBankingFlowOpen, setPhoneBankingFlowOpen] = useState(false)
  // The audience the tile click handed over (a ?listId= or ?recommended=
  // deep link the grid spent on hand-off) — set per open and cleared on
  // close, so a later open without one starts clean.
  const [tilePreselect, setTilePreselect] = useState<AudiencePreselect | null>(
    null,
  )
  const [smsFlowOpen, setSmsFlowOpen] = useState(false)
  // A saved draft the candidate is picking back up: the SMS flow opens on it
  // instead of starting a new text. Cleared on close, like tilePreselect.
  const [resumeDraft, setResumeDraft] = useState<OutreachDetail | null>(null)
  // The robocall sibling of the above — the two channels keep separate rows,
  // and a campaign can hold one draft of each.
  const [robocallResumeDraft, setRobocallResumeDraft] =
    useState<OutreachDetail | null>(null)
  // Which gesture resumed the draft. The drawer's own CTA already made the
  // Pro pitch, so it opens the wizard directly; a tile or deep link lands on
  // the pause screen first.
  const [resumeSource, setResumeSource] = useState<ResumeSource | null>(null)
  // Seeds a `?compose=` deep link handed over (a tracker/manager task's due
  // date, Know Your Opponent's suggested message, a CRM list). Held per open
  // and cleared on close, so a later tile click starts clean.
  const [composeSeeds, setComposeSeeds] = useState<ComposeRequest | null>(null)
  const seedOutreachDetail = useSeedOutreachDetail()

  // Nothing on screen says a detail read is running, so a second press
  // while one is in flight would open the flow twice (or on the wrong
  // channel). Ignored until it settles.
  const openingChannelRef = useRef(false)

  // Opening a resumable channel, with the campaign's saved draft of it if
  // there is one. The flow resumes from the DETAIL, not the row, so it opens
  // once that read lands; a failed read opens a new campaign rather than a
  // dead end, and the saved row is still there to try again from. The tile,
  // the compose deep link and a draft-row click share this, so none of them
  // owns the fetch.
  const openChannel = useCallback(
    (
      channel: DraftChannel,
      source: ResumeSource,
      row: HistoryRow | undefined = historyRows.find(
        (o) =>
          o.status === 'draft' &&
          DRAFT_CHANNELS[o.outreachType ?? ''] === channel,
      ),
    ) => {
      if (openingChannelRef.current) return
      const openWith = (draft: OutreachDetail | null) => {
        openingChannelRef.current = false
        setResumeSource(draft ? source : null)
        if (draft) {
          trackEvent(EVENTS.Outreach.Draft.Resumed, {
            channel: GATE_CHANNEL[channel],
            source,
          })
        }
        if (channel === 'text') {
          setResumeDraft(draft)
          setSmsFlowOpen(true)
          return
        }
        setRobocallResumeDraft(draft)
        setRobocallFlowOpen(true)
      }
      if (!row) {
        openWith(null)
        return
      }
      openingChannelRef.current = true
      fetchOutreachDetail(row.id).then(
        (detail) => {
          // The drawer and the history table's own metric read the same
          // detail — seed it so neither refetches what the resume just paid
          // for.
          seedOutreachDetail(detail)
          openWith(detail)
        },
        () => openWith(null),
      )
    },
    [historyRows, seedOutreachDetail],
  )

  // Every row opens the drawer. A draft row's drawer footer is the way back
  // into the flow that saved it (design: the `verify` footer's "Upgrade to
  // Pro" / "Start verification" / "Enter your PIN"), through the same
  // openChannel the tile and the deep link use.
  const handleRowClick = (row: HistoryRow) => {
    setDetailsRow(row)
  }
  const handleResumeDraft = (row: HistoryRow) => {
    const channel = DRAFT_CHANNELS[row.outreachType ?? '']
    if (channel) openChannel(channel, 'row', row)
  }

  // The deep link resolves the params and the channel gate; opening the right
  // flow is the hub's job, since it owns the one mount of each.
  // Texting and robocall go through openChannel, so an arrival on a channel
  // the campaign already holds a draft for resumes it rather than starting a
  // second campaign the server would refuse.
  const handleCompose = useCallback(
    (request: ComposeRequest) => {
      setComposeSeeds(request)
      if (request.type === OUTREACH_TYPES.text) {
        openChannel('text', 'deep_link')
        return
      }
      if (request.type === OUTREACH_TYPES.phoneBanking) {
        setPhoneBankingFlowOpen(true)
        return
      }
      if (request.type === OUTREACH_TYPES.socialMedia) {
        setSocialFlowOpen(true)
        return
      }
      openChannel('robocall', 'deep_link')
    },
    [openChannel],
  )

  // Same lookup `openChannel` runs, so the deep link's create event can say
  // the arrival is a resume rather than a new campaign.
  const resumesDraft = useCallback(
    (type: OutreachType) => {
      const channel = DRAFT_CHANNELS[type]
      return Boolean(
        draftsEnabled &&
        channel &&
        historyRows.some(
          (o) =>
            o.status === 'draft' &&
            DRAFT_CHANNELS[o.outreachType ?? ''] === channel,
        ),
      )
    },
    [draftsEnabled, historyRows],
  )

  // Where the open flow was started from, for its stage events and its Pro
  // gate. A compose link names its own surface; otherwise it was a tile.
  const composeFlowSource: OutreachFlowSource = composeSeeds
    ? flowSourceFromCompose(composeSeeds.source)
    : 'outreach_page'
  // Texting and robocall can also open off a saved draft's row. Read only
  // for those two: `resumeSource` is not cleared on close, so another
  // channel's tile would inherit a stale row.
  const draftFlowSource: OutreachFlowSource =
    !composeSeeds && resumeSource === 'row' ? 'draft' : composeFlowSource
  // The drawer footer is the one resume with a button behind it.
  const resumeCta = resumeSource === 'row' ? DRAFT_FOOTER_LABELS.pro : undefined

  // The save response is the created row: seed the detail cache (so the
  // drawer and the "N platforms" metric never refetch it) and prepend it to
  // the history without a list refetch.
  const handleSocialSaved = (detail: OutreachDetail) => {
    seedOutreachDetail(detail)
    setOutreaches([
      { ...detail, outreachType: 'socialMedia' },
      ...(outreaches ?? []),
    ])
  }

  // The phone-banking create response is the list, not a full OutreachDetail
  // (unlike social's save) — no detail to seed, just enough to prepend a row
  // so the history table doesn't stay stale until the next full load.
  // Status is in_progress (not completed) to match what
  // phoneBankingList.service.ts actually creates — historyStatus.util.ts
  // maps that to "In progress" for the native channels.
  const handlePhoneBankingSaved = (outreachId: number, name: string) => {
    setOutreaches([
      {
        id: outreachId,
        name,
        outreachType: 'nativePhoneBanking',
        status: 'in_progress',
        // OutreachHistoryTable sorts newest-first off date ?? createdAt
        // (rowTime falls back to 0 with neither); the create response
        // carries no timestamp, so without this the row sorts to the
        // bottom despite being prepended.
        createdAt: new Date().toISOString(),
      },
      ...(outreaches ?? []),
    ])
  }

  // A scheduled send only exists after a refetch (SMS finalizes server-side; a
  // robocall's pay step authorizes/defers and its spine flips to pending), so
  // the sending flows call this on their onScheduled to refresh the history
  // list without a page reload.
  const refetchOutreaches = async () => {
    const { data } = await clientRequest('GET /v1/outreach', {})
    setOutreaches(data ?? [])
  }

  // The list is SEEDED from a server component into `useState`, so it is a
  // snapshot of whenever this route's RSC last ran — and returning here from
  // another route can be served from the client router cache without
  // re-running it. Anything written while away is then missing: a campaign
  // the door-knocking flow just created does not appear in Active campaigns,
  // and a `?outreachId=` deep link to it finds nothing to open.
  //
  // One GET on mount settles all of it, and costs the same whoever arrives.
  // Fixing it here rather than at each caller is deliberate: every path back
  // has the problem, so a `router.refresh()` per departure would be the same
  // fix written once per exit and forgotten on the next one.
  const [listSettled, setListSettled] = useState(false)
  useEffect(() => {
    let cancelled = false
    // Settled only on success. A failed GET leaves the seeded snapshot, which
    // cannot resolve a campaign made while away, so the deep link below holds
    // its param rather than spending it; a reload retries it.
    void refetchOutreaches()
      .then(() => {
        if (!cancelled) setListSettled(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // Mount only: a refetch keyed on anything else would fire under the
    // drawer while the candidate is reading it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Consume-once (ENG-10769 conventions): strip the param, open the drawer
  // if the id resolves; the ref keeps an already-consumed id from reopening
  // while still accepting a new deep link arriving while mounted.
  //
  // **Held until the list above has settled.** The id used to be marked
  // consumed BEFORE the lookup, so a link to a row the seeded snapshot did
  // not carry spent the param and could never open — which is exactly the
  // campaign a candidate has this second created. Waiting costs one round
  // trip on a deep link and nothing on an ordinary visit; giving up after
  // it is what keeps a genuinely dead id from retrying forever.
  const consumedOutreachIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (
      !listSettled ||
      initialOutreachId === undefined ||
      initialOutreachId === consumedOutreachIdRef.current
    ) {
      return
    }
    consumedOutreachIdRef.current = initialOutreachId
    router.replace('/dashboard/outreach', { scroll: false })
    const row = outreaches?.find((o) => o.id === initialOutreachId)
    if (row) {
      setDetailsRow(row)
    }
  }, [listSettled, initialOutreachId, outreaches, router])

  return (
    <div className="mx-auto w-full max-w-7xl p-4 lg:p-6">
      <ChannelTileGrid
        tcrCompliance={tcrCompliance}
        preselectedListId={preselectedListId}
        preselectedRecommendedVariant={preselectedRecommendedVariant}
        onCreateSocial={() => setSocialFlowOpen(true)}
        onCreateSms={(preselect) => {
          setTilePreselect(preselect ?? null)
          openChannel('text', 'tile')
        }}
        onCreateRobocall={(preselect) => {
          setTilePreselect(preselect ?? null)
          openChannel('robocall', 'tile')
        }}
        onCreatePhoneBanking={(preselect) => {
          setTilePreselect(preselect ?? null)
          setPhoneBankingFlowOpen(true)
        }}
      />
      <SocialFlow
        open={socialFlowOpen}
        onClose={() => {
          setSocialFlowOpen(false)
          setComposeSeeds(null)
        }}
        onSaved={handleSocialSaved}
        prefill={composeSeeds?.socialPrefill}
        tracker={composeSeeds?.tracker}
        source={composeFlowSource}
      />
      <RobocallFlow
        open={robocallFlowOpen}
        onClose={() => {
          setRobocallFlowOpen(false)
          setComposeSeeds(null)
          setTilePreselect(null)
          setRobocallResumeDraft(null)
        }}
        onScheduled={refetchOutreaches}
        resumeDraft={robocallResumeDraft}
        resumeStartsOnWizard={resumeSource === 'row'}
        resumeCta={resumeCta}
        campaignPlanDueDate={composeSeeds?.due}
        tracker={composeSeeds?.tracker}
        source={draftFlowSource}
        preselectedListId={composeSeeds?.listId ?? tilePreselect?.listId}
        preselectedRecommendedVariant={
          composeSeeds?.recommendedVariant ?? tilePreselect?.recommendedVariant
        }
      />
      <PhoneBankingFlow
        open={phoneBankingFlowOpen}
        onClose={() => {
          setPhoneBankingFlowOpen(false)
          setComposeSeeds(null)
          setTilePreselect(null)
        }}
        onSaved={handlePhoneBankingSaved}
        tracker={composeSeeds?.tracker}
        source={composeFlowSource}
        preselectedListId={composeSeeds?.listId ?? tilePreselect?.listId}
        preselectedRecommendedVariant={
          composeSeeds?.recommendedVariant ?? tilePreselect?.recommendedVariant
        }
      />
      <SmsFlow
        open={smsFlowOpen}
        onClose={() => {
          setSmsFlowOpen(false)
          setComposeSeeds(null)
          setTilePreselect(null)
          setResumeDraft(null)
        }}
        onScheduled={refetchOutreaches}
        resumeDraft={resumeDraft}
        resumeStartsOnWizard={resumeSource === 'row'}
        resumeCta={resumeCta}
        tcrCompliance={tcrCompliance}
        campaignPlanDueDate={composeSeeds?.due}
        tracker={composeSeeds?.tracker}
        source={draftFlowSource}
        initialScript={composeSeeds?.script}
        preselectedListId={composeSeeds?.listId ?? tilePreselect?.listId}
        preselectedRecommendedVariant={
          composeSeeds?.recommendedVariant ?? tilePreselect?.recommendedVariant
        }
      />
      <Suspense>
        <OutreachComposeDeepLink
          tcrCompliance={tcrCompliance}
          onCompose={handleCompose}
          resumesDraft={resumesDraft}
        />
      </Suspense>
      <OutreachHistoryTable
        rows={historyRows}
        onRowClick={handleRowClick}
        membership={membership}
      />
      <OutreachDetailsDrawer
        row={detailsRow}
        onOpenChange={(open) => {
          if (!open) setDetailsRow(null)
        }}
        membership={membership}
        onResumeDraft={handleResumeDraft}
        onDraftDeleted={refetchOutreaches}
      />
    </div>
  )
}

export const OutreachHubPage = ({
  pathname,
  campaign,
  outreaches = [],
  tcrCompliance,
  preselectedListId,
  preselectedRecommendedVariant,
  initialOutreachId,
}: OutreachHubPageProps) => {
  useSingleEffect(() => {
    trackEvent(EVENTS.Outreach.ViewAccessed, { surface: 'v2' })
  }, [])

  return (
    <OutreachProvider initValue={outreaches}>
      <DashboardLayout
        pathname={pathname}
        campaign={campaign}
        navHeader={{ label: NAV_LABELS.voterOutreach }}
      >
        <OutreachHubContent
          {...{
            tcrCompliance,
            preselectedListId,
            preselectedRecommendedVariant,
            initialOutreachId,
          }}
        />
      </DashboardLayout>
    </OutreachProvider>
  )
}
