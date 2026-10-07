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
  PHONE_BANKING_NAME_MAX_LENGTH,
  type ChatCard,
  type ProposalLink,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeSmsFlag } from '@shared/experiments/serveSmsFlag'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProPitchDialog } from 'app/dashboard/shared/membership/ProPitchDialog'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { TcrCompliance } from 'helpers/types'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { useTextOutreachGate } from 'app/dashboard/outreach/hooks/useTextOutreachGate'
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

type Opened = { proposal: OutreachProposal; priorityId?: string }

type SentListener = (proposal: OutreachProposal) => void

type ProposalFlows = {
  mode: CardMode
  open: (proposal: OutreachProposal, priorityId?: string) => void
  // The conversation listens for a send finishing, to refresh what it shows
  // and tell the agent.
  listen: (listener: SentListener) => () => void
  // Whether text can be opened here; while the SMS flag is off there is no
  // text flow to open. On Win, whether the text gate has what it reads.
  textAvailable: boolean
  textResolved: boolean
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
const linkOf = ({ proposal, priorityId }: Opened): ProposalLink => ({
  proposalKey: proposal.proposalKey,
  ...(priorityId !== undefined && {
    priorityId,
    ...(proposal.stepId !== undefined &&
      proposal.side !== undefined && {
        stepId: proposal.stepId,
        side: proposal.side,
      }),
  }),
})

/**
 * Win's text gate, the one the Voter Outreach text tile runs
 * (ChannelTileGrid): behind outreach-pro-gating-v2 the flow gates itself, so
 * it opens; otherwise a free campaign goes to the Pro upgrade and a Pro one
 * passes only once its texting registration is approved.
 */
// Outreach Pro gating is fully rolled out, so a free campaign's card goes
// straight to the Pro pitch rather than into a flow it cannot finish. A Pro
// campaign then meets the same verification gate the Voter Outreach tile
// runs before the flow opens.
const useWinTextGate = (enabled: boolean) => {
  const [campaign] = useCampaign()
  const [pitchOpen, setPitchOpen] = useState(false)
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

  const run = (): boolean => {
    if (!isPro) {
      trackEvent(EVENTS.ProUpgrade.Compliance.LockedItemClicked, {
        type: OUTREACH_TYPES.text,
      })
      setPitchOpen(true)
      return false
    }
    return runTextGate()
  }

  return {
    ready: enabled && Boolean(campaign) && (!isPro || !isPending),
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
            channel="sms"
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
  const winText = useWinTextGate(mode === 'win')
  // The gate closes over the campaign and registration as of this render, so
  // `open` reads the latest one rather than changing identity every render.
  const winTextRun = useRef(winText.run)
  useEffect(() => {
    winTextRun.current = winText.run
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
      const audience = proposedAudienceOf(proposal)
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
      })
      router.push(`/dashboard/door-knocking?${params.toString()}`)
    },
    [router, errorSnackbar],
  )

  const open = useCallback(
    (proposal: OutreachProposal, priorityId?: string) => {
      if (mode === 'win') {
        // Campaign Manager proposes text alone; no other channel has a Win
        // flow mounted here.
        if (proposal.channel !== 'text' || !winTextRun.current()) return
        setOpened({
          proposal,
          ...(priorityId !== undefined && { priorityId }),
        })
        return
      }
      if (proposal.channel === 'doorKnocking') {
        void openDoorKnocking({
          proposal,
          ...(priorityId !== undefined && { priorityId }),
        })
        return
      }
      setOpened({ proposal, ...(priorityId !== undefined && { priorityId }) })
    },
    [openDoorKnocking, mode],
  )

  const value = useMemo(
    () => ({
      mode,
      open,
      listen,
      textAvailable: mode === 'win' || (sms.ready && sms.enabled),
      textResolved: mode === 'win' ? winText.ready : sms.ready,
    }),
    [mode, open, listen, sms.ready, sms.enabled, winText.ready],
  )

  const proposal = opened?.proposal
  const proposedAudience = proposal ? proposedAudienceOf(proposal) : undefined
  const listId = proposal?.savedFilterId ?? undefined
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
      {opened && mode === 'serve' && proposal?.channel === 'social' ? (
        <SocialFlow
          open
          onClose={close}
          onSaved={settled}
          surface={SERVE_SOCIAL_SURFACE}
          prefill={{
            draftText: proposal.message,
            proposalLink: linkOf(opened),
          }}
          source="deep_link"
        />
      ) : null}
      {opened && mode === 'serve' && proposal?.channel === 'phoneBanking' ? (
        <PhoneBankingFlow
          open
          onClose={close}
          onSaved={settled}
          surface={SERVE_PHONE_BANKING_SURFACE}
          {...(listId !== undefined && { preselectedListId: listId })}
          {...(proposedAudience && { proposedAudience })}
          initialScript={proposal.message}
          {...(proposal.event && { initialEvent: proposal.event })}
          initialName={proposalListName(proposal).slice(
            0,
            PHONE_BANKING_NAME_MAX_LENGTH,
          )}
          proposalLink={linkOf(opened)}
          source="deep_link"
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
          {...(proposal.event && { initialEvent: proposal.event })}
          {...(listId !== undefined && { preselectedListId: listId })}
          {...(proposedAudience && { proposedAudience })}
          proposalLink={linkOf(opened)}
          source="deep_link"
        />
      ) : null}
      {/* Win's own surface, not SERVE_SMS_SURFACE, and only once the text
          gate has passed. The flow's in-flow gate still runs behind
          outreach-pro-gating-v2. */}
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
          {...(winProposalLink && { proposalLink: winProposalLink })}
          onProposalCreateFailed={proposalCreateFailed}
          source="campaign_manager"
        />
      ) : null}
      {winText.modals}
    </ProposalFlowsContext.Provider>
  )
}
