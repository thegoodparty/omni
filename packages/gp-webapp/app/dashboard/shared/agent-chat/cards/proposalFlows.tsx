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
import { useQueryClient } from '@tanstack/react-query'
import {
  PHONE_BANKING_NAME_MAX_LENGTH,
  type ChatCard,
  type ProposalLink,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeSmsFlag } from '@shared/experiments/serveSmsFlag'
import { transformVoterFileFiltersForBackend } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import {
  SERVE_SMS_SURFACE,
  SmsFlow,
  useServeSmsSignedBody,
} from 'app/dashboard/outreach/v2/sms/SmsFlow'
import {
  SERVE_SOCIAL_SURFACE,
  SocialFlow,
} from 'app/dashboard/outreach/v2/social/SocialFlow'
import { proposalOutreachQueryKey } from './cardQueries'
import { proposalListName, proposedAudienceOf } from './proposalPresentation'

type OutreachProposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

type Opened = { proposal: OutreachProposal; priorityId?: string }

type SentListener = (proposal: OutreachProposal) => void

type ProposalFlows = {
  open: (proposal: OutreachProposal, priorityId?: string) => void
  // The conversation listens for a send finishing, to refresh what it shows
  // and tell the agent.
  listen: (listener: SentListener) => () => void
  // Whether text can be opened here; while the SMS flag is off there is no
  // text flow to open.
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
 * The outreach flows, mounted over the conversation. A proposal opens the
 * same drawer the outreach page opens for its channel, filled in with what
 * the card carries, and closing or finishing it leaves the official in the
 * thread where they were. Door knocking is the exception: its create flow is
 * drawn on its own map page, so the card goes there.
 */
export const ProposalFlowsProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const router = useRouter()
  const queryClient = useQueryClient()
  // Not the treatment surface: the outreach page's SMS card is.
  const sms = useServeSmsFlag(false)
  const signSms = useServeSmsSignedBody()
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
      if (proposal.channel === 'doorKnocking') {
        void openDoorKnocking({
          proposal,
          ...(priorityId !== undefined && { priorityId }),
        })
        return
      }
      setOpened({ proposal, ...(priorityId !== undefined && { priorityId }) })
    },
    [openDoorKnocking],
  )

  const value = useMemo(
    () => ({
      open,
      listen,
      textAvailable: sms.ready && sms.enabled,
      textResolved: sms.ready,
    }),
    [open, listen, sms.ready, sms.enabled],
  )

  const proposal = opened?.proposal
  const proposedAudience = proposal ? proposedAudienceOf(proposal) : undefined
  const listId = proposal?.savedFilterId ?? undefined

  return (
    <ProposalFlowsContext.Provider value={value}>
      {children}
      {/* Mounted only while open, the way the priority prototype mounted
          them (feat/serve-priorities-flow): each opens fresh on the proposal
          and closing it unmounts it, leaving the conversation as it was. */}
      {opened && proposal?.channel === 'social' ? (
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
      {opened && proposal?.channel === 'phoneBanking' ? (
        <PhoneBankingFlow
          open
          onClose={close}
          onSaved={settled}
          surface={SERVE_PHONE_BANKING_SURFACE}
          {...(listId !== undefined && { preselectedListId: listId })}
          {...(proposedAudience && { proposedAudience })}
          initialScript={proposal.message}
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
      {opened && proposal?.channel === 'text' && sms.ready && sms.enabled ? (
        <SmsFlow
          open
          onClose={close}
          onScheduled={async () => settled()}
          surface={SERVE_SMS_SURFACE}
          initialScript={signSms(proposal.message)}
          {...(listId !== undefined && { preselectedListId: listId })}
          {...(proposedAudience && { proposedAudience })}
          proposalLink={linkOf(opened)}
          source="deep_link"
        />
      ) : null}
    </ProposalFlowsContext.Provider>
  )
}
