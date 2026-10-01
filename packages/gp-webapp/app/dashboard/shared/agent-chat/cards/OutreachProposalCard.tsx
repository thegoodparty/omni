import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ChatCard } from '@goodparty_org/contracts'
import { Avatar } from '@styleguide'
import { MegaphoneIcon } from '@styleguide/components/ui/icons'
import { getChannelLabel } from 'app/dashboard/outreach/v2/channelMeta'
import { shortOutreachDate } from 'app/dashboard/outreach/v2/outreachDate.util'
import { useServeSmsFlag } from '@shared/experiments/serveSmsFlag'
import {
  CompactCardLink,
  CompactCardLoading,
  CompactCardStatic,
  CompactCardUnavailable,
} from './cardShell'
import { proposalOutreachQueryOptions } from './cardQueries'
import {
  cardOutreachType,
  handoffPayload,
  handoffStorageKey,
  outreachDetailHref,
  peopleCount,
  proposalComposeHref,
  proposalSampleLine,
  type CardChannel,
} from './proposalPresentation'

export const SERVE_OUTREACH_PROPOSAL_COPY = {
  sentTo: 'Sent to',
  textUnavailable: 'Texting is not available for your office yet',
}

type OutreachProposal = Extract<ChatCard, { kind: 'outreach_proposal' }>

const ProposalMark = () => (
  <Avatar aria-hidden>
    <Avatar.Icon>
      <MegaphoneIcon />
    </Avatar.Icon>
  </Avatar>
)

/**
 * A pointer into the channel's own flow, never a second compose screen. The
 * click lands the official in that flow with the list and the message already
 * in, short of anything that sends or charges, and the send happens there.
 *
 * Still resolved by `proposalKey`, so a proposal already sent under its key
 * reads as sent and opens that send's history instead.
 */
export const OutreachProposalCard = ({
  proposal,
  priorityId,
}: {
  proposal: OutreachProposal
  // Absent outside a priority (Chief of Staff): the send links to no priority.
  priorityId?: string
}) => {
  const channel: CardChannel = proposal.channel
  // Not the treatment surface: the hub's SMS card is, so no exposure here.
  const sms = useServeSmsFlag(false)
  const {
    data: sent,
    isPending,
    isError,
  } = useQuery(proposalOutreachQueryOptions(proposal.proposalKey))

  // Minted once per mount so the href can carry it; the payload is written
  // on click. A right-click "open in new tab" therefore arrives with no
  // stored payload, which the hub already handles by opening unprefilled.
  const [handoffNonce] = useState(() => {
    try {
      return crypto.randomUUID()
    } catch {
      return ''
    }
  })

  if (isPending) return <CompactCardLoading />
  if (isError) return <CompactCardUnavailable />

  if (sent) {
    const when = sent.date ?? sent.createdAt
    return (
      <CompactCardLink
        leading={<ProposalMark />}
        title={proposal.audience}
        subtitle={`${SERVE_OUTREACH_PROPOSAL_COPY.sentTo} ${peopleCount(
          sent.textCount ?? sent.billableTextCount ?? proposal.count,
        )}${when ? ` · ${shortOutreachDate(when)}` : ''}`}
        href={outreachDetailHref(sent.id)}
      />
    )
  }

  // The text flow is not mounted on the hub while SMS is off, so a link there
  // would land on a page with nothing open. Say so instead.
  if (channel === 'text' && sms.ready && !sms.enabled) {
    return (
      <CompactCardStatic
        leading={<ProposalMark />}
        title={proposal.audience}
        subtitle={SERVE_OUTREACH_PROPOSAL_COPY.textUnavailable}
      />
    )
  }

  const carryDraft = () => {
    const payload = handoffPayload(proposal, priorityId)
    if (!payload || !handoffNonce) return
    try {
      sessionStorage.setItem(
        handoffStorageKey(handoffNonce),
        JSON.stringify(payload),
      )
    } catch {
      // No storage (private browsing, quota): the hub opens unprefilled.
    }
  }

  return (
    <CompactCardLink
      leading={<ProposalMark />}
      title={proposal.audience}
      subtitle={
        proposalSampleLine(proposal) ??
        [
          getChannelLabel(cardOutreachType(channel)),
          channel === 'social' ? '' : peopleCount(proposal.count),
        ]
          .filter(Boolean)
          .join(' · ')
      }
      href={proposalComposeHref(proposal, handoffNonce)}
      onNavigate={carryDraft}
    />
  )
}
