import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { outreachHasGoneOut, type ChatCard } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { getChannelLabel } from 'app/dashboard/outreach/v2/channelMeta'
import type { OutreachLaunchSource } from 'app/dashboard/outreach/util/outreachAnalytics'
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
  PROPOSAL_CTA,
  PROPOSAL_OUTREACH_TYPE,
  type CardMode,
  outreachDetailHref,
  peopleCount,
  proposalSampleLine,
} from './proposalPresentation'

export const SERVE_OUTREACH_PROPOSAL_COPY = {
  sentTo: 'Sent to',
  textingOn: (people: string, day: string) => `Texting ${people} on ${day}`,
  textUnavailable: 'Texting is not available for your office yet',
}

export const WIN_OUTREACH_PROPOSAL_COPY = {
  sentTo: 'Sent to',
}

const SENT_TO: Record<CardMode, string> = {
  win: WIN_OUTREACH_PROPOSAL_COPY.sentTo,
  serve: SERVE_OUTREACH_PROPOSAL_COPY.sentTo,
}

type OutreachProposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

type OutreachProposalCardProps = {
  proposal: OutreachProposal
  // Absent outside a priority (Chief of Staff): the send links to no priority.
  priorityId?: string
  // Set when the surface knows more than the flows' default, such as a
  // priority card that answered Get answers.
  launchSource?: OutreachLaunchSource
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
const ProposalChip = ({
  proposal,
  priorityId,
  launchSource,
}: OutreachProposalCardProps) => {
  const flows = useProposalFlows()
  const mode = flows?.mode ?? 'serve'
  const {
    data: sent,
    isPending,
    isError,
  } = useQuery(proposalOutreachQueryOptions(proposal.proposalKey))

  if (isPending) return <CompactCardLoading />
  if (isError) return <CompactCardUnavailable />

  if (sent) {
    // A Serve text carries its day only in scheduledLocalDate, and is paid
    // for, and found under its key, days before that day comes.
    const scheduledFor = sent.scheduledLocalDate ?? null
    const people = peopleCount(
      sent.textCount ?? sent.billableTextCount ?? proposal.count,
      mode,
    )
    const when = scheduledFor ?? sent.date ?? sent.createdAt
    const notOutYet =
      mode === 'serve' &&
      proposal.channel === 'text' &&
      scheduledFor !== null &&
      !outreachHasGoneOut(
        { status: sent.status, scheduledFor },
        format(new Date(), 'yyyy-MM-dd'),
      )
    return (
      <CompactCardLink
        title={proposal.audience}
        subtitle={
          notOutYet
            ? SERVE_OUTREACH_PROPOSAL_COPY.textingOn(
                people,
                shortOutreachDate(scheduledFor),
              )
            : `${SENT_TO[mode]} ${people}${when ? ` · ${shortOutreachDate(when)}` : ''}`
        }
        href={outreachDetailHref(sent.id, mode)}
      />
    )
  }

  const channelLine =
    proposalSampleLine(proposal) ??
    [
      getChannelLabel(PROPOSAL_OUTREACH_TYPE[proposal.channel]),
      proposal.channel === 'social' ? '' : peopleCount(proposal.count, mode),
    ]
      .filter(Boolean)
      .join(' · ')

  // The text flow is not mounted while SMS is off (Serve), or texting has
  // closed for this race (Win), so there is nothing to open. Serve says so
  // rather than offer a button that does nothing; Win drops the card, so the
  // manager never points a candidate at a channel they cannot use.
  if (
    proposal.channel === 'text' &&
    flows?.textResolved &&
    !flows.textAvailable
  ) {
    if (mode === 'win') return null
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
          // Win's gate reads the campaign first, and a text its texting
          // registration too; a press before they arrive would gate on
          // neither.
          disabled={
            !flows ||
            (mode === 'win' &&
              !(proposal.channel === 'text'
                ? flows.textResolved
                : flows.winResolved))
          }
          onClick={() => flows?.open(proposal, priorityId, launchSource)}
        >
          {PROPOSAL_CTA[mode][proposal.channel]}
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
