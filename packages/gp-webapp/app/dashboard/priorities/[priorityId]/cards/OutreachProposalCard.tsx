import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatCard } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import { ChannelBadge } from 'app/dashboard/outreach/v2/channelMeta'
import { shortOutreachDate } from 'app/dashboard/outreach/v2/outreachDate.util'
import { CardLoading, CardNote, CardShell, CardUnavailable } from './cardShell'
import {
  proposalOutreachQueryKey,
  proposalOutreachQueryOptions,
} from './cardQueries'
import {
  handoffStorageKey,
  outreachDetailHref,
  peopleCount,
  proposalComposeHref,
  PROPOSAL_OUTREACH_TYPE,
  socialHandoffPayload,
} from './proposalPresentation'

export const SERVE_OUTREACH_PROPOSAL_COPY = {
  send: 'Send',
  sending: 'Sending',
  finishInOutreach: 'Finish in outreach',
  openInOutreach: 'Open in outreach',
  sendFailed: 'That did not send. Try again, or finish it in outreach.',
  sentTo: 'Sent to',
}

type OutreachProposalCardProps = {
  proposal: Extract<ChatCard, { kind: 'outreach_proposal' }>
  priorityId: string
  conversationId: string
}

const MessageBody = ({ message }: { message: string }) => (
  <p className="text-foreground mt-3 text-base leading-relaxed whitespace-pre-wrap">
    {message}
  </p>
)

export const OutreachProposalCard = ({
  proposal,
  priorityId,
}: OutreachProposalCardProps) => {
  const queryClient = useQueryClient()
  const { proposalKey, channel, message, why } = proposal

  // Derived, not read. The card renders the model's raw tool args, so a model
  // that wrote `deepLinkOnly: false` on a social proposal would otherwise be
  // offering an elected official a Send button that cannot send.
  const deepLinkOnly = proposal.deepLinkOnly || channel !== 'phoneBanking'

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

  const {
    data: sent,
    isPending,
    isError,
  } = useQuery(proposalOutreachQueryOptions(proposalKey))

  const send = useMutation({
    mutationFn: async (): Promise<Outreach> => {
      const { kind: _kind, proposalKey: _key, ...body } = proposal
      const res = await clientRequest(
        'PUT /v1/outreach/by-proposal-key/:proposalKey',
        { proposalKey, priorityId, ...body },
      )
      return res.data
    },
    // The route is an idempotent create, so the row it hands back IS the live
    // outreach. Seeding it flips the card in place with no second read.
    onSuccess: (outreach) => {
      queryClient.setQueryData(proposalOutreachQueryKey(proposalKey), outreach)
    },
  })

  if (isPending) return <CardLoading rows={3} />
  if (isError) return <CardUnavailable />

  if (sent) {
    const when = sent.date ?? sent.createdAt
    return (
      <CardShell>
        <div className="flex flex-wrap items-center gap-2">
          <ChannelBadge
            type={sent.outreachType ?? PROPOSAL_OUTREACH_TYPE[channel]}
          />
          <span className="text-muted-foreground text-[13px]">
            {SERVE_OUTREACH_PROPOSAL_COPY.sentTo}{' '}
            {peopleCount(
              sent.textCount ?? sent.billableTextCount ?? proposal.count,
            )}
            {when ? ` · ${shortOutreachDate(when)}` : ''}
          </span>
        </div>
        <MessageBody message={sent.message ?? sent.script ?? message} />
        <div className="mt-4 flex items-center">
          <Button asChild variant="outline" size="small">
            <a href={outreachDetailHref(sent.id)}>
              {SERVE_OUTREACH_PROPOSAL_COPY.openInOutreach}
            </a>
          </Button>
        </div>
      </CardShell>
    )
  }

  const composeHref = proposalComposeHref(proposal, handoffNonce)

  const carryDraft = () => {
    if (channel !== 'social' || !handoffNonce) return
    try {
      sessionStorage.setItem(
        handoffStorageKey(handoffNonce),
        JSON.stringify(socialHandoffPayload(message)),
      )
    } catch {
      // No storage (private browsing, quota): the hub opens unprefilled.
    }
  }

  return (
    <CardShell>
      <div className="flex flex-wrap items-center gap-2">
        <ChannelBadge type={PROPOSAL_OUTREACH_TYPE[channel]} />
        <span className="text-muted-foreground text-[13px]">
          {proposal.audience} · {peopleCount(proposal.count)}
        </span>
      </div>
      <MessageBody message={message} />
      <div className="mt-3">
        <CardNote>{why}</CardNote>
      </div>
      {send.isError ? (
        <p className="text-destructive-dark mt-3 text-[13px]">
          {SERVE_OUTREACH_PROPOSAL_COPY.sendFailed}
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        {deepLinkOnly ? (
          <Button asChild size="small">
            <a href={composeHref} onClick={carryDraft}>
              {SERVE_OUTREACH_PROPOSAL_COPY.finishInOutreach}
            </a>
          </Button>
        ) : (
          <>
            <Button
              size="small"
              loading={send.isPending}
              loadingText={SERVE_OUTREACH_PROPOSAL_COPY.sending}
              disabled={send.isPending || send.isSuccess}
              onClick={() => send.mutate()}
            >
              {SERVE_OUTREACH_PROPOSAL_COPY.send}
            </Button>
            <Button asChild variant="outline" size="small">
              <a href={composeHref} onClick={carryDraft}>
                {SERVE_OUTREACH_PROPOSAL_COPY.openInOutreach}
              </a>
            </Button>
          </>
        )}
      </div>
    </CardShell>
  )
}
