import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ChatCard } from '@goodparty_org/contracts'
import { Avatar } from '@styleguide'
import { MegaphoneIcon } from '@styleguide/components/ui/icons'
import { getChannelLabel } from 'app/dashboard/outreach/v2/channelMeta'
import { shortOutreachDate } from 'app/dashboard/outreach/v2/outreachDate.util'
import {
  CompactCardLink,
  CompactCardLoading,
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
  type CardChannel,
} from './proposalPresentation'

export const SERVE_OUTREACH_PROPOSAL_COPY = {
  sentTo: 'Sent to',
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
}: {
  proposal: OutreachProposal
}) => {
  const channel: CardChannel = proposal.channel
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

  const carryDraft = () => {
    const payload = handoffPayload(proposal)
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
      subtitle={[
        getChannelLabel(cardOutreachType(channel)),
        channel === 'social' ? '' : peopleCount(proposal.count),
      ]
        .filter(Boolean)
        .join(' · ')}
      href={proposalComposeHref(proposal, handoffNonce)}
      onNavigate={carryDraft}
    />
  )
}
