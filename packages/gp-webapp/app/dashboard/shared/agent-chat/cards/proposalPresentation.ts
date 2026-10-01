import type { ListSample, ProposalChannel } from '@goodparty_org/contracts'
import type { OutreachType } from 'gpApi/types/outreach.types'
import type { ProposalHandoff } from 'app/dashboard/constituent-outreach/proposalHandoff'

const SERVE_OUTREACH_HUB = '/dashboard/constituent-outreach'

// Door knocking is a live channel the proposal contract is gaining. Widened
// here so the card routes it the day the enum carries it, and compiles both
// before and after.
export type CardChannel = ProposalChannel | 'doorKnocking'

// The proposal vocabulary is the chat's, the badge vocabulary is outreach's.
// One map rather than a second copy of the channel labels, so a card and a
// history row never name the same channel differently.
export const PROPOSAL_OUTREACH_TYPE: Record<ProposalChannel, OutreachType> = {
  social: 'socialMedia',
  phoneBanking: 'phoneBanking',
  text: 'text',
  doorKnocking: 'nativeDoorKnocking',
}

export const cardOutreachType = (channel: CardChannel): OutreachType =>
  channel === 'doorKnocking'
    ? 'nativeDoorKnocking'
    : PROPOSAL_OUTREACH_TYPE[channel]

/**
 * Into the channel's own flow, where the official reviews and sends. The
 * draft and the list ride the sessionStorage handoff (`handoffPayload`) so
 * the message is never in a shareable link. Door knocking is drawn over its
 * own map, a route rather than a drawer, and takes the list as `?listId=`.
 */
export const proposalComposeHref = (
  proposal: { channel: CardChannel; savedFilterId?: number | null },
  handoffNonce: string,
): string => {
  if (proposal.channel === 'doorKnocking') {
    const params = new URLSearchParams({ create: '1' })
    if (proposal.savedFilterId) {
      params.set('listId', String(proposal.savedFilterId))
    }
    return `/dashboard/door-knocking?${params.toString()}`
  }
  const params = new URLSearchParams({ compose: proposal.channel })
  if (handoffNonce) params.set('handoff', handoffNonce)
  return `${SERVE_OUTREACH_HUB}?${params.toString()}`
}

export const handoffStorageKey = (nonce: string) => `cos-handoff-${nonce}`

/**
 * What the hub reads back for the channel, or null when nothing rides (door
 * knocking takes its list on the URL). The proposal link rides with it so the
 * flow's own create is linked to the priority and idempotent on the key.
 */
export const handoffPayload = (
  proposal: {
    channel: CardChannel
    message: string
    savedFilterId?: number | null
    listName?: string | null
    audience: string
    proposalKey: string
  },
  priorityId?: string,
): ProposalHandoff | null =>
  proposal.channel === 'doorKnocking'
    ? null
    : {
        channel: proposal.channel,
        message: proposal.message,
        savedFilterId: proposal.savedFilterId ?? null,
        name: proposal.listName?.trim() || proposal.audience,
        proposalKey: proposal.proposalKey,
        ...(priorityId !== undefined && { priorityId }),
      }

export const outreachDetailHref = (outreachId: number): string =>
  `${SERVE_OUTREACH_HUB}?outreachId=${outreachId}`

export const peopleCount = (count: number): string =>
  count === 1 ? '1 constituent' : `${count.toLocaleString()} constituents`

// A sample smaller than its audience is the only kind that changes who gets
// it: the list and the server both read anything bigger as the whole thing.
const isSampled = (proposal: {
  count: number
  sampleSize?: number
}): proposal is { count: number; sampleSize: number } =>
  proposal.sampleSize !== undefined && proposal.sampleSize < proposal.count

const SAMPLE_VERB: Record<ProposalChannel, string> = {
  text: 'Text',
  phoneBanking: 'Call',
  doorKnocking: 'Visit',
  social: 'Reach',
}

/** "Text 4,000 of 58,520, picked at random", or null for the whole list. */
export const proposalSampleLine = (proposal: {
  channel: ProposalChannel
  count: number
  sampleSize?: number
}): string | null =>
  isSampled(proposal)
    ? `${SAMPLE_VERB[proposal.channel]} ${proposal.sampleSize.toLocaleString()} of ${proposal.count.toLocaleString()}, picked at random`
    : null

/**
 * The sample a list saved from this proposal is drawn as, keyed on the
 * proposal so saving it again draws the same people. Undefined saves the
 * live list.
 */
export const proposalListSample = (proposal: {
  proposalKey: string
  count: number
  sampleSize?: number
  widensOutreachIds?: number[]
}): ListSample | undefined =>
  isSampled(proposal)
    ? {
        size: proposal.sampleSize,
        seedKey: proposal.proposalKey,
        ...(proposal.widensOutreachIds?.length && {
          excludeOutreachIds: proposal.widensOutreachIds,
        }),
      }
    : undefined
