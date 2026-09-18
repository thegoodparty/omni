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

  // A draft row reopens the flow that saved it; every other row opens the
  // read-only drawer.
  const handleRowClick = (row: HistoryRow) => {
    const channel = DRAFT_CHANNELS[row.outreachType ?? '']
    if (draftsEnabled && row.status === 'draft' && channel) {
      openChannel(channel, 'row', row)
      return
    }
    setDetailsRow(row)
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

  // Consume-once (ENG-10769 conventions): strip the param, open the drawer
  // if the id resolves; the ref keeps an already-consumed id from reopening
  // while still accepting a new deep link arriving while mounted.
  const consumedOutreachIdRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (
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
  }, [initialOutreachId, outreaches, router])

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
        campaignPlanDueDate={composeSeeds?.due}
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
        tcrCompliance={tcrCompliance}
        campaignPlanDueDate={composeSeeds?.due}
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
