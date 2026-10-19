import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BUILD_CITIZENS_PANEL_PURPOSE,
  PHONE_BANKING_NAME_MAX_LENGTH,
  REPORT_BACK_PURPOSE,
  type ChatCard,
  type ProposalChannel,
  type ProposalLink,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeSmsFlag } from '@shared/experiments/serveSmsFlag'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProPitchDialog } from 'app/dashboard/shared/membership/ProPitchDialog'
import type { ProUpgradeChannel } from 'app/dashboard/pro-upgrade/proUpgradeAttribution'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { OutreachLaunchSource } from 'app/dashboard/outreach/util/outreachAnalytics'
import type { TcrCompliance } from 'helpers/types'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import {
  TCR_COMPLIANCE_QUERY_KEY,
  getTcrCompliance,
} from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
import { transformVoterFileFiltersForBackend } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import {
  SERVE_SMS_SURFACE,
  SmsFlow,
} from 'app/dashboard/outreach/v2/sms/SmsFlow'
import {
  SERVE_SOCIAL_SURFACE,
  SocialFlow,
} from 'app/dashboard/outreach/v2/social/SocialFlow'
import {
  proposalOutreachQueryKey,
  proposalOutreachQueryOptions,
} from './cardQueries'
import {
  proposalListName,
  proposedAudienceOf,
  type CardMode,
} from './proposalPresentation'

type OutreachProposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

type Opened = {
  proposal: OutreachProposal
  priorityId?: string
  // The list the card's audience was saved as, when the flow opens on its
  // message with that list picked rather than on the list builder.
  listId?: number
  launchSource: OutreachLaunchSource
}

// The list a card's audience was saved as, kept by the card's key so opening
// the card again, even after a reload, reuses it instead of saving another.
const STORED_LIST_PREFIX = 'proposal-list:'
const readStoredList = (proposalKey: string): number | null => {
  try {
    const raw = window.localStorage.getItem(STORED_LIST_PREFIX + proposalKey)
    const id = raw === null ? NaN : Number(raw)
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}
const storeList = (proposalKey: string, listId: number): void => {
  try {
    window.localStorage.setItem(
      STORED_LIST_PREFIX + proposalKey,
      String(listId),
    )
  } catch {
    // Without storage a reopen after a reload saves the list again.
  }
}

// The channels whose flow opens on the message with the card's list already
// picked.
const READY_CHANNELS: ReadonlySet<ProposalChannel> = new Set([
  'text',
  'phoneBanking',
])

type SentListener = (proposal: OutreachProposal) => void

type ProposalFlows = {
  mode: CardMode
  // launchSource names the card's surface when the default (Campaign
  // Manager on Win, else priorities or Chief of Staff) is not enough.
  open: (
    proposal: OutreachProposal,
    priorityId?: string,
    launchSource?: OutreachLaunchSource,
  ) => void
  // The conversation listens for a send finishing, to refresh what it shows
  // and tell the agent.
  listen: (listener: SentListener) => () => void
  // Whether text can be opened here; while the SMS flag is off there is no
  // text flow to open, and on Win none once the SMS compliance window has
  // closed. textResolved: on Win, whether the text gate has what it reads.
  textAvailable: boolean
  textResolved: boolean
  // On Win, whether the campaign the Pro gate reads has loaded. The other
  // channels need nothing more, so they do not wait on the registration.
  winResolved: boolean
}

const ProposalFlowsContext = createContext<ProposalFlows | null>(null)

export const useProposalFlows = (): ProposalFlows | null =>
  useContext(ProposalFlowsContext)

/** Called with the proposal each time outreach a card opened is finished. */
export const useOnProposalSent = (listener: SentListener): void => {
  const flows = useContext(ProposalFlowsContext)
  const latest = useRef(listener)
  useEffect(() => {
    latest.current = listener
  }, [listener])
  const listen = flows?.listen
  useEffect(() => listen?.((proposal) => latest.current(proposal)), [listen])
}

// The check rides along only on a priority, where there is one to put out.
// A report back is linked through the send it answers instead, so it is
// never read as another ask on the priority.
const linkOf = ({ proposal, priorityId }: Opened): ProposalLink => ({
  proposalKey: proposal.proposalKey,
  ...(priorityId !== undefined &&
    proposal.reportBackForOutreachId === undefined && {
      priorityId,
      ...(proposal.stepId !== undefined &&
        proposal.side !== undefined && {
          stepId: proposal.stepId,
          side: proposal.side,
        }),
    }),
})

type WinProChannel = 'text' | 'phoneBanking' | 'doorKnocking'

const WIN_PRO_CHANNEL: Record<
  WinProChannel,
  { type: string; pitch: ProUpgradeChannel }
> = {
  text: { type: OUTREACH_TYPES.text, pitch: 'sms' },
  phoneBanking: { type: OUTREACH_TYPES.phoneBanking, pitch: 'phone-bank' },
  doorKnocking: { type: OUTREACH_TYPES.doorKnocking, pitch: 'door' },
}

/**
 * Win's gates for the channels Pro pays for. Social is free and has none.
 */
// Outreach Pro gating is fully rolled out, so a free campaign's card goes
// straight to that channel's Pro pitch rather than into a flow it cannot
// finish. A Pro campaign's text then meets the same verification gate the
// Voter Outreach tile runs before the flow opens.
const useWinOutreachGate = (enabled: boolean) => {
  const [campaign] = useCampaign()
  const [pitchOpen, setPitchOpen] = useState(false)
  const [pitchChannel, setPitchChannel] = useState<ProUpgradeChannel>('sms')
  const { data, isPending } = useQuery({
    queryKey: TCR_COMPLIANCE_QUERY_KEY,
    queryFn: getTcrCompliance,
    enabled: enabled && Boolean(campaign),
  })
  const tcrCompliance: TcrCompliance | undefined = data ?? undefined
  const { runTextGate, gateModals } = useTextOutreachGate(
    tcrCompliance,
    'campaign_manager',
  )
  const isPro = Boolean(campaign?.isPro)

  const run = (channel: WinProChannel): boolean => {
    if (!isPro) {
      const { type, pitch } = WIN_PRO_CHANNEL[channel]
      trackEvent(EVENTS.ProUpgrade.Compliance.LockedItemClicked, { type })
      setPitchChannel(pitch)
      setPitchOpen(true)
      return false
    }
    return channel === 'text' ? runTextGate() : true
  }

  return {
    ready: enabled && Boolean(campaign) && (!isPro || !isPending),
    campaignReady: enabled && Boolean(campaign),
    run,
    tcrCompliance,
    modals: enabled ? (
      <>
        {gateModals}
        {campaign && (
          <ProPitchDialog
            open={pitchOpen}
            onOpenChange={setPitchOpen}
            source="campaign_manager"
            channel={pitchChannel}
          />
        )}
      </>
    ) : null,
  }
}

/**
 * The outreach flows, mounted over the conversation. A proposal opens the
 * same drawer the outreach page opens for its channel, filled in with what
 * the card carries, and closing or finishing it leaves the official in the
 * thread where they were. Door knocking is the exception: its create flow is
 * drawn on its own map page, so the card goes there.
 */
export const ProposalFlowsProvider = ({
  children,
  mode = 'serve',
}: {
  children: ReactNode
  // Campaign Manager is Win. Chief of Staff and the priority workspace are
  // Serve, and a card outside any surface's provider reads as Serve.
  mode?: CardMode
}) => {
  const router = useRouter()
  const queryClient = useQueryClient()
  // Not the treatment surface: the outreach page's SMS card is.
  const sms = useServeSmsFlag(false)
  const winText = useWinOutreachGate(mode === 'win')
  // useSmsCompliance reads 'open' until the campaign loads, so closed is
  // already resolved.
  const { smsCompliance } = useSmsCompliance()
  const winSmsClosed = mode === 'win' && smsCompliance === 'closed'
  // The gate closes over the campaign and registration as of this render, so
  // `open` reads the latest one rather than changing identity every render.
  const winGateRun = useRef(winText.run)
  useEffect(() => {
    winGateRun.current = winText.run
  })
  const [opened, setOpened] = useState<Opened | null>(null)
  const { errorSnackbar } = useSnackbar()

  const listeners = useRef(new Set<SentListener>())
  const listen = useCallback((listener: SentListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const close = useCallback(() => setOpened(null), [])
  const settled = useCallback(() => {
    if (!opened) return
    void queryClient.invalidateQueries({
      queryKey: proposalOutreachQueryKey(opened.proposal.proposalKey),
    })
    listeners.current.forEach((listener) => listener(opened.proposal))
  }, [opened, queryClient])

  // A 409 on the create is the server saying the card already went out (or
  // another send holds its key). Re-read the card: once it resolves as sent
  // it reads so on its own, and the flow has nothing left to buy.
  const proposalCreateFailed = useCallback(async () => {
    if (!opened) return
    try {
      const sent = await queryClient.fetchQuery({
        ...proposalOutreachQueryOptions(opened.proposal.proposalKey),
        staleTime: 0,
      })
      if (sent) close()
    } catch {
      // The flow's own error line already says the create failed.
    }
  }, [opened, queryClient, close])

  const openDoorKnocking = useCallback(
    async (opened: Opened) => {
      const { proposal } = opened
      // The map page takes a saved list and nothing else, so this is the
      // latest point the list can be saved: the official has started.
      const audience = proposedAudienceOf(proposal, opened.priorityId)
      let listId = proposal.savedFilterId ?? null
      if (listId === null && audience) {
        try {
          const { data } = await clientRequest(
            'POST /v1/voters/voter-file/filter',
            {
              name: audience.name,
              ...transformVoterFileFiltersForBackend(audience.filters),
              supportStatus: audience.supportStatus,
              precincts: audience.precincts,
              ...(audience.sample && { sample: audience.sample }),
              ...(audience.unreachedAreaOfPriorityId && {
                unreachedAreaOfPriorityId: audience.unreachedAreaOfPriorityId,
              }),
            },
          )
          listId = data.id
        } catch {
          // The card's button stays live, so pressing it again retries.
          errorSnackbar("We couldn't save this list. Try again.")
          return
        }
      }
      // The card's link rides to the walk's own create, which puts the check
      // out on the server: nothing here survives the navigation to say so.
      const params = new URLSearchParams({
        create: '1',
        ...(listId ? { listId: String(listId) } : {}),
        ...linkOf(opened),
        launchSource: opened.launchSource,
      })
      router.push(`/dashboard/door-knocking?${params.toString()}`)
    },
    [router, errorSnackbar],
  )

  const savedLists = useRef(new Map<string, number>())
  const savingLists = useRef(new Map<string, Promise<number | null>>())

  // Saves the card's audience as a list once, the way the builder would have
  // after the official confirmed it, so the flow can open on the message.
  // The panel invite always goes to its seeded draw of the district, never a
  // list a card named.
  const saveProposalList = useCallback(
    (
      proposal: OutreachProposal,
      priorityId?: string,
    ): Promise<number | null> => {
      const key = proposal.proposalKey
      const inFlight = savingLists.current.get(key)
      if (inFlight) return inFlight
      const run = (async () => {
        const buildsPanel = proposal.purpose === BUILD_CITIZENS_PANEL_PURPOSE
        if (!buildsPanel && proposal.savedFilterId) {
          return proposal.savedFilterId
        }
        const known = savedLists.current.get(key) ?? readStoredList(key)
        if (known !== null) {
          const { data } = await clientRequest(
            'GET /v1/voters/voter-file/filters',
            {},
          )
          if ((data ?? []).some((list) => list?.id === known)) {
            savedLists.current.set(key, known)
            return known
          }
        }
        const audience = proposedAudienceOf(
          { ...proposal, savedFilterId: undefined },
          priorityId,
        )
        if (!audience) return null
        const { data } = await clientRequest(
          'POST /v1/voters/voter-file/filter',
          {
            name: audience.name,
            ...transformVoterFileFiltersForBackend(audience.filters),
            supportStatus: audience.supportStatus,
            precincts: audience.precincts,
            ...(audience.sample && { sample: audience.sample }),
            ...(audience.unreachedAreaOfPriorityId && {
              unreachedAreaOfPriorityId: audience.unreachedAreaOfPriorityId,
            }),
          },
        )
        savedLists.current.set(key, data.id)
        storeList(key, data.id)
        return data.id
      })()
      savingLists.current.set(key, run)
      const settle = () => savingLists.current.delete(key)
      void run.then(settle, settle)
      return run
    },
    [],
  )

  const open = useCallback(
    (
      proposal: OutreachProposal,
      priorityId?: string,
      launchSource?: OutreachLaunchSource,
    ) => {
      if (
        mode === 'win' &&
        proposal.channel !== 'social' &&
        !winGateRun.current(proposal.channel)
      ) {
        return
      }
      const link = {
        ...(priorityId !== undefined && { priorityId }),
        launchSource:
          launchSource ??
          (mode === 'win'
            ? 'campaign_manager'
            : priorityId !== undefined
              ? 'priorities'
              : 'chief_of_staff'),
      } satisfies Omit<Opened, 'proposal'>
      if (proposal.channel === 'doorKnocking') {
        void openDoorKnocking({ proposal, ...link })
        return
      }
      if (READY_CHANNELS.has(proposal.channel)) {
        void saveProposalList(proposal, priorityId).then(
          (listId) =>
            setOpened({
              proposal,
              ...link,
              ...(listId !== null && { listId }),
            }),
          () => {
            // The card's button stays live, so pressing it again retries.
            errorSnackbar("We couldn't save this list. Try again.")
          },
        )
        return
      }
      setOpened({ proposal, ...link })
    },
    [openDoorKnocking, mode, saveProposalList, errorSnackbar],
  )

  const value = useMemo(
    () => ({
      mode,
      open,
      listen,
      textAvailable: mode === 'win' ? !winSmsClosed : sms.ready && sms.enabled,
      textResolved: mode === 'win' ? winSmsClosed || winText.ready : sms.ready,
      winResolved: winText.campaignReady,
    }),
    [
      mode,
      open,
      listen,
      sms.ready,
      sms.enabled,
      winSmsClosed,
      winText.ready,
      winText.campaignReady,
    ],
  )

  const proposal = opened?.proposal
  // A text or phone banking card's list is saved before its flow opens, so
  // the flow picks that list and, with the card's message, opens on the
  // message (outreachLandingStep), never the builder. A card with no
  // audience to save opens on the picker with the message held.
  const readyListId = opened?.listId
  const proposedAudience =
    proposal && readyListId === undefined
      ? proposedAudienceOf(proposal, opened?.priorityId)
      : undefined
  const listId = readyListId ?? proposal?.savedFilterId ?? undefined
  // Stable across renders, since the Win text create effect depends on it.
  const winProposalLink = useMemo(
    () => (opened ? linkOf(opened) : undefined),
    [opened],
  )

  return (
    <ProposalFlowsContext.Provider value={value}>
      {children}
      {/* Mounted only while open, the way the priority prototype mounted
          them (feat/serve-priorities-flow): each opens fresh on the proposal
          and closing it unmounts it, leaving the conversation as it was. */}
      {/* Without a surface each flow is Win's, which takes the card's key
          alone; Campaign Manager cards carry no priority. */}
      {opened && proposal?.channel === 'social' ? (
        <SocialFlow
          open
          onClose={close}
          onSaved={settled}
          {...(mode === 'serve' && { surface: SERVE_SOCIAL_SURFACE })}
          prefill={{
            draftText: proposal.message,
            proposalLink: linkOf(opened),
          }}
          source={mode === 'win' ? 'campaign_manager' : 'deep_link'}
          launchSource={opened.launchSource}
        />
      ) : null}
      {opened && proposal?.channel === 'phoneBanking' ? (
        <PhoneBankingFlow
          open
          onClose={close}
          onSaved={settled}
          {...(mode === 'serve' && { surface: SERVE_PHONE_BANKING_SURFACE })}
          {...(listId !== undefined && { preselectedListId: listId })}
          {...(proposedAudience && { proposedAudience })}
          initialScript={proposal.message}
          {...(proposal.event && { initialEvent: proposal.event })}
          initialName={proposalListName(proposal).slice(
            0,
            PHONE_BANKING_NAME_MAX_LENGTH,
          )}
          proposalLink={linkOf(opened)}
          source={mode === 'win' ? 'campaign_manager' : 'deep_link'}
          launchSource={opened.launchSource}
        />
      ) : null}
      {/* Behind the flag the outreach page mounts it behind, so a chat cannot
          reach a Serve SMS request the outreach page would not. */}
      {opened &&
      mode === 'serve' &&
      proposal?.channel === 'text' &&
      sms.ready &&
      sms.enabled ? (
        <SmsFlow
          open
          onClose={close}
          onScheduled={async () => settled()}
          surface={SERVE_SMS_SURFACE}
          initialScript={proposal.message}
          initialAsksToJoinCivicPanel={proposal.civicPanelAsk === true}
          {...(proposal.purpose && { initialPurpose: proposal.purpose })}
          {...(proposal.reportBackForOutreachId !== undefined && {
            initialPurpose: REPORT_BACK_PURPOSE,
            reportBackForOutreachId: proposal.reportBackForOutreachId,
          })}
          {...(proposal.event && { initialEvent: proposal.event })}
          {...(listId !== undefined && { preselectedListId: listId })}
          {...(proposedAudience && { proposedAudience })}
          audienceSettled={readyListId !== undefined}
          proposalLink={linkOf(opened)}
          source="deep_link"
          launchSource={opened.launchSource}
        />
      ) : null}
      {/* Win's own surface, not SERVE_SMS_SURFACE, and only once the text
          gate has passed. The flow's in-flow gate still runs. */}
      {opened && mode === 'win' && proposal?.channel === 'text' ? (
        <SmsFlow
          open
          onClose={close}
          onScheduled={async () => settled()}
          tcrCompliance={winText.tcrCompliance}
          initialScript={proposal.message}
          {...(proposal.event && { initialEvent: proposal.event })}
          {...(listId !== undefined && { preselectedListId: listId })}
          {...(proposedAudience && { proposedAudience })}
          audienceSettled={readyListId !== undefined}
          {...(winProposalLink && { proposalLink: winProposalLink })}
          onProposalCreateFailed={proposalCreateFailed}
          source="campaign_manager"
          launchSource={opened.launchSource}
        />
      ) : null}
      {winText.modals}
    </ProposalFlowsContext.Provider>
  )
}
