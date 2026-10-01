import {
  PROPOSAL_SENT_MARKER,
  SupportStatusRollupSchema,
  type ListSample,
  type OutreachProposal,
  type ProposalChannel,
  type SupportStatusRollup,
} from '@goodparty_org/contracts'
import type { OutreachType } from 'gpApi/types/outreach.types'
import { segmentToVoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import type { ProposedAudience } from 'app/dashboard/outreach/v2/audience/useOutreachAudience'
import { MAX_SEGMENT_NAME_LENGTH } from 'app/dashboard/contacts/crm/shared/segments.util'

const SERVE_OUTREACH_HUB = '/dashboard/constituent-outreach'

// The proposal vocabulary is the chat's, the badge vocabulary is outreach's.
// One map rather than a second copy of the channel labels, so a card and a
// history row never name the same channel differently.
export const PROPOSAL_OUTREACH_TYPE: Record<ProposalChannel, OutreachType> = {
  social: 'socialMedia',
  phoneBanking: 'phoneBanking',
  text: 'text',
  // The native walk the Serve hub lists, not Win's legacy door-knocking type.
  doorKnocking: 'nativeDoorKnocking',
}

export const SERVE_PROPOSAL_CTA: Record<ProposalChannel, string> = {
  text: 'Start the text',
  phoneBanking: 'Start the calls',
  social: 'Start the post',
  doorKnocking: 'Start the walk',
}

const SENT_CHANNEL: Record<ProposalChannel, string> = {
  text: 'the text',
  phoneBanking: 'the calls',
  social: 'the post',
  doorKnocking: 'the walk',
}

/**
 * The hidden turn that tells the agent a card's outreach went out. Ends on
 * the proposal key, which is how a reload knows it was already sent.
 */
export const proposalSentMessage = (
  proposal: Pick<
    OutreachProposal,
    'channel' | 'count' | 'audience' | 'proposalKey'
  >,
): string =>
  `${PROPOSAL_SENT_MARKER} I sent ${SENT_CHANNEL[proposal.channel]} to ` +
  `${proposal.audience} (${proposal.count} people). ${proposal.proposalKey}`

export const isProposalSentMessage = (content: string): boolean =>
  content.startsWith(PROPOSAL_SENT_MARKER)

/** What the list is called once the official saves it. */
export const proposalListName = (
  proposal: Pick<OutreachProposal, 'listName' | 'audience'>,
): string =>
  (proposal.listName?.trim() || proposal.audience).slice(
    0,
    MAX_SEGMENT_NAME_LENGTH,
  )

/**
 * The counted-but-unsaved audience, as the flows' list builder holds it, or
 * undefined for a card that already points at a saved list (or none).
 */
export const proposedAudienceOf = (
  proposal: Pick<
    OutreachProposal,
    | 'audienceFilters'
    | 'savedFilterId'
    | 'listName'
    | 'audience'
    | 'proposalKey'
    | 'count'
    | 'sampleSize'
    | 'widensOutreachIds'
  >,
): ProposedAudience | undefined => {
  const filters = proposal.audienceFilters
  if (!filters || proposal.savedFilterId) return undefined
  const sample = proposalListSample(proposal)
  const list = (value: boolean | string[] | undefined): string[] =>
    Array.isArray(value) ? value : []
  return {
    filters: segmentToVoterFileFilters(filters),
    supportStatus: list(filters.supportStatus).filter(
      (status): status is SupportStatusRollup =>
        SupportStatusRollupSchema.safeParse(status).success,
    ),
    precincts: list(filters.precincts),
    name: proposalListName(proposal),
    ...(sample && { sample }),
  }
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
