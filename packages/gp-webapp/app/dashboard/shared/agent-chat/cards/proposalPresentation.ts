import type {
  ComposeHandoffPayload,
  OutreachProposal,
  ProposalChannel,
} from '@goodparty_org/contracts'
import type { OutreachType } from 'gpApi/types/outreach.types'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/constants'
import {
  formatOutreachCost,
  outreachCostCents,
} from 'app/dashboard/outreach/util/outreachPricing'
import type { ReachabilityKey } from 'app/dashboard/outreach/v2/audience/useOutreachAudience'

const SERVE_OUTREACH_HUB = '/dashboard/constituent-outreach'

// The proposal vocabulary is the chat's, the badge vocabulary is outreach's.
// One map rather than a second copy of the channel labels, so a card and a
// history row never name the same channel differently.
export const PROPOSAL_OUTREACH_TYPE: Record<ProposalChannel, OutreachType> = {
  social: 'socialMedia',
  phoneBanking: 'phoneBanking',
  text: 'text',
  doorKnocking: 'doorKnocking',
}

const COMPOSE_PARAM: Record<
  Exclude<ProposalChannel, 'doorKnocking'>,
  string
> = {
  social: 'social',
  phoneBanking: 'phoneBanking',
  text: 'text',
}

/**
 * Into the full flow, carrying whatever that flow can currently accept: the
 * saved audience as a param, and for social the draft itself through the
 * sessionStorage handoff the Chief of Staff already uses (the text rides
 * storage, not the URL, so the draft is never in a shareable link).
 */
export const proposalComposeHref = (
  proposal: Pick<OutreachProposal, 'channel' | 'savedFilterId'>,
  handoffNonce?: string,
): string => {
  // Door knocking is its own page rather than a hub flow, and its create
  // flow takes the list the same way the CRM channel picker hands it one.
  // No source: the page already reads an unnamed `?create=1` as a deep link.
  if (proposal.channel === 'doorKnocking') {
    return proposal.savedFilterId
      ? `/dashboard/door-knocking?create=1&listId=${proposal.savedFilterId}`
      : '/dashboard/door-knocking?create=1'
  }
  const params = new URLSearchParams({
    compose: COMPOSE_PARAM[proposal.channel],
  })
  // Social has no audience step, so a listId there would be read and dropped.
  if (proposal.channel !== 'social' && proposal.savedFilterId) {
    params.set('listId', String(proposal.savedFilterId))
  }
  if (proposal.channel === 'social' && handoffNonce) {
    params.set('handoff', handoffNonce)
  }
  return `${SERVE_OUTREACH_HUB}?${params.toString()}`
}

export const handoffStorageKey = (nonce: string) => `cos-handoff-${nonce}`

export const socialHandoffPayload = (
  message: string,
): ComposeHandoffPayload => ({
  channel: 'serve_social',
  draftText: message,
})

export const outreachDetailHref = (outreachId: number): string =>
  `${SERVE_OUTREACH_HUB}?outreachId=${outreachId}`

export const peopleCount = (count: number): string =>
  count === 1 ? '1 constituent' : `${count.toLocaleString()} constituents`

// Which reachability leaf a channel is counted by, the same mapping the
// outreach flows hand their audience step. Social has none: a post has no
// recipients, so there is no list to pick and no count to follow it.
export const PROPOSAL_REACHABILITY_KEY: Record<
  ProposalChannel,
  ReachabilityKey | null
> = {
  social: null,
  phoneBanking: 'phoneBanking',
  text: 'sms',
  doorKnocking: 'doorKnocking',
}

export const proposalHasAudience = (channel: ProposalChannel): boolean =>
  PROPOSAL_REACHABILITY_KEY[channel] !== null

// The per-person rate the hub tiles, the CRM channel picker and every outreach
// flow already read. Nothing here restates it: text carries a rate there,
// phone banking and social are zero because the official does that work.
const pricePerPerson = (channel: ProposalChannel): number =>
  OUTREACH_OPTIONS.find(
    (option) => option.type === PROPOSAL_OUTREACH_TYPE[channel],
  )?.cost ?? 0

export const isFreeChannel = (channel: ProposalChannel): boolean =>
  pricePerPerson(channel) === 0

export const estimatedCostCents = (
  channel: ProposalChannel,
  count: number,
): number => outreachCostCents(count, pricePerPerson(channel))

export const formatDollars = formatOutreachCost
