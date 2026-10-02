import { useQuery } from '@tanstack/react-query'
import type { ChatCard } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { getChannelLabel } from 'app/dashboard/outreach/v2/channelMeta'
import { shortOutreachDate } from 'app/dashboard/outreach/v2/outreachDate.util'
import {
  CompactCardLink,
  CompactCardLoading,
  CompactCardStatic,
  CompactCardUnavailable,
} from './cardShell'
import { proposalOutreachQueryOptions } from './cardQueries'
import { ProposalFlowsProvider, useProposalFlows } from './proposalFlows'
import {
  PROPOSAL_OUTREACH_TYPE,
  SERVE_PROPOSAL_CTA,
  outreachDetailHref,
  peopleCount,
} from './proposalPresentation'

export const SERVE_OUTREACH_PROPOSAL_COPY = {
  sentTo: 'Sent to',
  textUnavailable: 'Texting is not available for your office yet',
}

type OutreachProposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

type OutreachProposalCardProps = {
  proposal: OutreachProposal
  // Absent outside a priority (Chief of Staff): the send links to no priority.
  priorityId?: string
}

/**
 * Who, how many, the one channel, and a button that opens that channel's own
 * flow over the conversation, filled in. Nothing else: why these people and
 * why this channel are in the agent's message above it, and the flow owns
 * every choice and every cost.
 *
 * Still resolved by `proposalKey`, so a proposal already sent under its key
 * reads as sent and leads to that send.
 */
const ProposalChip = ({ proposal, priorityId }: OutreachProposalCardProps) => {
  const flows = useProposalFlows()
  const {
    data: sent,
    isPending,
    isError,
  } = useQuery(proposalOutreachQueryOptions(proposal.proposalKey))

  if (isPending) return <CompactCardLoading />
  if (isError) return <CompactCardUnavailable />

  if (sent) {
    const when = sent.date ?? sent.createdAt
    return (
      <CompactCardLink
        title={proposal.audience}
        subtitle={`${SERVE_OUTREACH_PROPOSAL_COPY.sentTo} ${peopleCount(
          sent.textCount ?? sent.billableTextCount ?? proposal.count,
        )}${when ? ` · ${shortOutreachDate(when)}` : ''}`}
        href={outreachDetailHref(sent.id)}
      />
    )
  }

  const channelLine = [
    getChannelLabel(PROPOSAL_OUTREACH_TYPE[proposal.channel]),
    proposal.channel === 'social' ? '' : peopleCount(proposal.count),
  ]
    .filter(Boolean)
    .join(' · ')

  // The text flow is not mounted while SMS is off, so there is nothing to
  // open. Say so rather than offer a button that does nothing.
  if (
    proposal.channel === 'text' &&
    flows?.textResolved &&
    !flows.textAvailable
  ) {
    return (
      <CompactCardStatic
        title={proposal.audience}
        subtitle={SERVE_OUTREACH_PROPOSAL_COPY.textUnavailable}
      />
    )
  }

  return (
    <CompactCardStatic
      title={proposal.audience}
      subtitle={channelLine}
      action={
        <Button
          type="button"
          size="small"
          className="shrink-0"
          disabled={!flows}
          onClick={() => flows?.open(proposal, priorityId)}
        >
          {SERVE_PROPOSAL_CTA[proposal.channel]}
        </Button>
      }
    />
  )
}

export const OutreachProposalCard = (props: OutreachProposalCardProps) => {
  const flows = useProposalFlows()
  // A surface that mounted no flows still gets working cards.
  return flows ? (
    <ProposalChip {...props} />
  ) : (
    <ProposalFlowsProvider>
      <ProposalChip {...props} />
    </ProposalFlowsProvider>
  )
}
