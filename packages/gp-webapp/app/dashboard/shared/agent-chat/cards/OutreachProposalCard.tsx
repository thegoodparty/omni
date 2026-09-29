import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatCard, ProposalChannel } from '@goodparty_org/contracts'
import { PROPOSAL_CHANNELS } from '@goodparty_org/contracts'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import {
  ChannelBadge,
  getChannelLabel,
} from 'app/dashboard/outreach/v2/channelMeta'
import { shortOutreachDate } from 'app/dashboard/outreach/v2/outreachDate.util'
import { CardLoading, CardNote, CardShell, CardUnavailable } from './cardShell'
import {
  listReachQueryOptions,
  proposalOutreachQueryKey,
  proposalOutreachQueryOptions,
  savedListsQueryOptions,
} from './cardQueries'
import {
  estimatedCostCents,
  formatDollars,
  handoffStorageKey,
  isFreeChannel,
  outreachDetailHref,
  peopleCount,
  proposalComposeHref,
  PROPOSAL_OUTREACH_TYPE,
  PROPOSAL_REACHABILITY_KEY,
  socialHandoffPayload,
} from './proposalPresentation'

export const SERVE_OUTREACH_PROPOSAL_COPY = {
  send: 'Send',
  sending: 'Sending',
  finishInOutreach: 'Finish in outreach',
  openInOutreach: 'Open in outreach',
  sendFailed: 'That did not send. Try again, or finish it in outreach.',
  sentTo: 'Sent to',
  channelLabel: 'Channel',
  messageLabel: 'Message',
  listLabel: 'List',
  listsLoading: 'Loading your lists…',
  noLists: 'No saved lists yet. Build one in contacts first.',
  chooseList: 'Choose a constituent list',
  counting: 'Counting reachable constituents…',
  countFailed: 'We could not count this list right now.',
  estimatedCost: 'Estimated cost',
}

// Why a channel is free, in the official's terms, not ours. "$0.00" reads
// like a price we are still working out.
export const SERVE_PROPOSAL_FREE_NOTE: Record<ProposalChannel, string> = {
  social: 'Free. You post it yourself.',
  phoneBanking: 'Free. You make the calls.',
  text: '',
}

// What happens after the deep link, for the two channels that are always one.
// Only where the consequence is the official's money or their next decision;
// phone banking reaching here is a model flag, and has nothing to add.
export const SERVE_PROPOSAL_DEEP_LINK_NOTE: Record<
  ProposalChannel,
  string | null
> = {
  social: 'You will pick where to post it in outreach.',
  text: 'You will pay for this text in outreach before it goes out.',
  phoneBanking: null,
}

type OutreachProposalCardProps = {
  proposal: Extract<ChatCard, { kind: 'outreach_proposal' }>
  priorityId?: string
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
  const { proposalKey, why } = proposal
  const orgSlug = useOrganization()?.slug

  // The edits live here until Send. Nothing is persisted on keystroke, and the
  // key is untouched by any of them: it names THIS proposal, and what the
  // official chose to send under it is what these hold.
  const [channel, setChannel] = useState<ProposalChannel>(proposal.channel)
  const [message, setMessage] = useState(proposal.message)
  const [listId, setListId] = useState<number | null>(
    proposal.savedFilterId ?? null,
  )

  // Derived, not read. The card renders the model's raw tool args, so a model
  // that wrote `deepLinkOnly: false` on a social proposal would otherwise be
  // offering an elected official a Send button that cannot send — and the
  // official can now pick that channel themselves.
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

  const reachabilityKey = PROPOSAL_REACHABILITY_KEY[channel]
  const hasAudience = reachabilityKey !== null

  const listsQuery = useQuery({
    ...savedListsQueryOptions(orgSlug),
    enabled: hasAudience,
  })

  // The agent's count was measured against ITS list on ITS channel, and both
  // are now the official's to change — a phone banking count is landlines and
  // an SMS count is cell phones, so even the same list moves. While the pair
  // is untouched the quoted number stands and nothing is read; change either
  // and the count is fetched for what is actually selected.
  const countIsTheAgents =
    listId === (proposal.savedFilterId ?? null) && channel === proposal.channel

  const reachQuery = useQuery(
    listReachQueryOptions(
      orgSlug,
      reachabilityKey,
      listId,
      hasAudience && !countIsTheAgents,
    ),
  )

  const count = countIsTheAgents
    ? proposal.count
    : (reachQuery.data?.reachable ?? null)

  const listOptions = useMemo(() => {
    const named = (listsQuery.data ?? [])
      .map((list) => ({ id: list.id, name: list.name ?? '' }))
      .filter((option) => option.name.length > 0)
    // The agent's list can be one the picker hides (an unnamed row, a
    // per-send throwaway). Carrying it in as an option is the difference
    // between a card that shows its list and one that looks unaddressed.
    if (listId !== null && !named.some((option) => option.id === listId)) {
      named.unshift({
        id: listId,
        name: proposal.listName ?? proposal.audience,
      })
    }
    return named
  }, [listsQuery.data, listId, proposal.listName, proposal.audience])

  const listName =
    listOptions.find((option) => option.id === listId)?.name ?? null

  const send = useMutation({
    mutationFn: async (): Promise<Outreach> => {
      const { kind: _kind, proposalKey: _key, ...body } = proposal
      const res = await clientRequest(
        'PUT /v1/outreach/by-proposal-key/:proposalKey',
        {
          ...body,
          proposalKey,
          ...(priorityId !== undefined && { priorityId }),
          channel,
          message,
          savedFilterId: listId,
          listName,
          count: count ?? proposal.count,
          deepLinkOnly,
        },
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

  const composeHref = proposalComposeHref(
    { channel, savedFilterId: listId },
    handoffNonce,
  )
  const deepLinkNote = SERVE_PROPOSAL_DEEP_LINK_NOTE[channel]

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

  const priceLine = isFreeChannel(channel)
    ? SERVE_PROPOSAL_FREE_NOTE[channel]
    : count === null
      ? ''
      : `${SERVE_OUTREACH_PROPOSAL_COPY.estimatedCost} ${formatDollars(
          estimatedCostCents(channel, count),
        )}`

  const countLine = !hasAudience
    ? ''
    : reachQuery.isFetching
      ? SERVE_OUTREACH_PROPOSAL_COPY.counting
      : count === null
        ? SERVE_OUTREACH_PROPOSAL_COPY.countFailed
        : peopleCount(count)

  return (
    <CardShell>
      <ToggleGroup
        type="single"
        variant="pills"
        size="sm"
        aria-label={SERVE_OUTREACH_PROPOSAL_COPY.channelLabel}
        value={channel}
        // Radix hands back '' when the pressed item is toggled off. A card
        // with no channel is not a state this can be in.
        onValueChange={(next) => {
          if (next) setChannel(next as ProposalChannel)
        }}
      >
        {PROPOSAL_CHANNELS.map((option) => (
          <ToggleGroupItem key={option} value={option}>
            {getChannelLabel(PROPOSAL_OUTREACH_TYPE[option])}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {hasAudience ? (
        <div className="mt-3">
          {listsQuery.isPending ? (
            <CardNote>{SERVE_OUTREACH_PROPOSAL_COPY.listsLoading}</CardNote>
          ) : listOptions.length === 0 ? (
            <CardNote>{SERVE_OUTREACH_PROPOSAL_COPY.noLists}</CardNote>
          ) : (
            <Select
              value={listId === null ? '' : String(listId)}
              onValueChange={(next) => setListId(next ? Number(next) : null)}
            >
              <SelectTrigger
                aria-label={SERVE_OUTREACH_PROPOSAL_COPY.listLabel}
                className="w-full"
              >
                <SelectValue
                  placeholder={SERVE_OUTREACH_PROPOSAL_COPY.chooseList}
                />
              </SelectTrigger>
              <SelectContent>
                {listOptions.map((option) => (
                  <SelectItem key={option.id} value={String(option.id)}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : null}

      {countLine || priceLine ? (
        <p className="text-muted-foreground mt-2 text-[13px]">
          {[countLine, priceLine].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      <Textarea
        aria-label={SERVE_OUTREACH_PROPOSAL_COPY.messageLabel}
        className="mt-3 text-base leading-relaxed"
        autoGrow
        maxRows={14}
        rows={5}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />

      <div className="mt-3">
        <CardNote>{why}</CardNote>
      </div>
      {send.isError ? (
        <p className="text-destructive-dark mt-3 text-[13px]">
          {SERVE_OUTREACH_PROPOSAL_COPY.sendFailed}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {deepLinkOnly ? (
          <>
            <Button asChild size="small">
              <a href={composeHref} onClick={carryDraft}>
                {SERVE_OUTREACH_PROPOSAL_COPY.finishInOutreach}
              </a>
            </Button>
            {deepLinkNote ? <CardNote>{deepLinkNote}</CardNote> : null}
          </>
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
