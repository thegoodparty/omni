import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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

type ProposalFlows = {
  open: (proposal: OutreachProposal, priorityId?: string) => void
  // Whether text can be opened here; while the SMS flag is off there is no
  // text flow to open.
  textAvailable: boolean
  textResolved: boolean
}

const ProposalFlowsContext = createContext<ProposalFlows | null>(null)

export const useProposalFlows = (): ProposalFlows | null =>
  useContext(ProposalFlowsContext)

const linkOf = ({ proposal, priorityId }: Opened): ProposalLink => ({
  proposalKey: proposal.proposalKey,
  ...(priorityId !== undefined && { priorityId }),
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

  const close = useCallback(() => setOpened(null), [])
  const settled = useCallback(() => {
    if (!opened) return
    void queryClient.invalidateQueries({
      queryKey: proposalOutreachQueryKey(opened.proposal.proposalKey),
    })
  }, [opened, queryClient])

  const openDoorKnocking = useCallback(
    async (proposal: OutreachProposal) => {
      // The map page takes a saved list and nothing else, so this is the
      // latest point the list can be saved: the official has started.
      const audience = proposedAudienceOf(proposal)
      const listId =
        proposal.savedFilterId ??
        (audience
          ? (
              await clientRequest('POST /v1/voters/voter-file/filter', {
                name: audience.name,
                ...transformVoterFileFiltersForBackend(audience.filters),
                supportStatus: audience.supportStatus,
                precincts: audience.precincts,
              })
            ).data.id
          : null)
      router.push(
        listId
          ? `/dashboard/door-knocking?create=1&listId=${listId}`
          : '/dashboard/door-knocking?create=1',
      )
    },
    [router],
  )

  const open = useCallback(
    (proposal: OutreachProposal, priorityId?: string) => {
      if (proposal.channel === 'doorKnocking') {
        void openDoorKnocking(proposal)
        return
      }
      setOpened({ proposal, ...(priorityId !== undefined && { priorityId }) })
    },
    [openDoorKnocking],
  )

  const value = useMemo(
    () => ({
      open,
      textAvailable: sms.ready && sms.enabled,
      textResolved: sms.ready,
    }),
    [open, sms.ready, sms.enabled],
  )

  const proposal = opened?.proposal
  const proposedAudience = proposal ? proposedAudienceOf(proposal) : undefined
  const listId = proposal?.savedFilterId ?? undefined

  return (
    <ProposalFlowsContext.Provider value={value}>
      {children}
      <SocialFlow
        open={proposal?.channel === 'social'}
        onClose={close}
        onSaved={settled}
        surface={SERVE_SOCIAL_SURFACE}
        {...(opened &&
          proposal?.channel === 'social' && {
            prefill: {
              draftText: proposal.message,
              proposalLink: linkOf(opened),
            },
          })}
        source="deep_link"
      />
      <PhoneBankingFlow
        open={proposal?.channel === 'phoneBanking'}
        onClose={close}
        onSaved={settled}
        surface={SERVE_PHONE_BANKING_SURFACE}
        {...(opened &&
          proposal?.channel === 'phoneBanking' && {
            ...(listId !== undefined && { preselectedListId: listId }),
            ...(proposedAudience && { proposedAudience }),
            initialScript: proposal.message,
            initialName: proposalListName(proposal).slice(
              0,
              PHONE_BANKING_NAME_MAX_LENGTH,
            ),
            proposalLink: linkOf(opened),
          })}
        source="deep_link"
      />
      {/* Behind the flag the outreach page mounts it behind, so a chat cannot
          reach a Serve SMS request the outreach page would not. */}
      {sms.ready && sms.enabled ? (
        <SmsFlow
          open={proposal?.channel === 'text'}
          onClose={close}
          onScheduled={async () => settled()}
          surface={SERVE_SMS_SURFACE}
          {...(proposal?.channel === 'text' && {
            initialScript: signSms(proposal.message),
            ...(listId !== undefined && { preselectedListId: listId }),
            ...(proposedAudience && { proposedAudience }),
          })}
          source="deep_link"
        />
      ) : null}
    </ProposalFlowsContext.Provider>
  )
}
