import type {
  ComposeHandoffPayload,
  OutreachProposal,
  ProposalChannel,
} from '@goodparty_org/contracts'
import type { OutreachType } from 'gpApi/types/outreach.types'

const SERVE_OUTREACH_HUB = '/dashboard/constituent-outreach'

// The proposal vocabulary is the chat's, the badge vocabulary is outreach's.
// One map rather than a second copy of the channel labels, so a card and a
// history row never name the same channel differently.
export const PROPOSAL_OUTREACH_TYPE: Record<ProposalChannel, OutreachType> = {
  social: 'socialMedia',
  phoneBanking: 'phoneBanking',
  text: 'text',
}

const COMPOSE_PARAM: Record<ProposalChannel, string> = {
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
