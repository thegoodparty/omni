import { z } from 'zod'

/**
 * Anchored views: the cards an agent can leave in a chat.
 *
 * A card is a reference, not a snapshot. The message persists `{ kind, ... }`
 * and the client resolves the live resource at render time, so re-opening a
 * thread next week shows today's truth rather than what was true when the
 * model spoke.
 *
 * Deliberately scope-agnostic. Chief of Staff should be able to emit the same
 * cards a priority chat does, so anything added here is available everywhere.
 */

export const CHAT_CARD_KINDS = [
  'outreach_proposal',
  'past_outreach',
  'contacts',
] as const

export const ChatCardKindSchema = z.enum(CHAT_CARD_KINDS)
export type ChatCardKind = z.infer<typeof ChatCardKindSchema>

/** Channels a proposal can be sent straight from the chat. */
export const PROPOSAL_CHANNELS = ['social', 'phoneBanking', 'text'] as const
export const ProposalChannelSchema = z.enum(PROPOSAL_CHANNELS)
export type ProposalChannel = z.infer<typeof ProposalChannelSchema>

/**
 * A ready-to-send piece of outreach. The agent has already built the list and
 * written the message, so the only act left is sending it.
 *
 * `proposalKey` is minted SERVER-SIDE from the tool call, never by the model,
 * and is what links this card to the Outreach row once one exists. The card
 * resolves by it: nothing found means not sent yet.
 */
export const OutreachProposalSchema = z.object({
  proposalKey: z.string().uuid(),
  audience: z.string().min(1),
  count: z.number().int().nonnegative(),
  channel: ProposalChannelSchema,
  savedFilterId: z.number().int().positive().nullish(),
  listName: z.string().nullish(),
  /** What goes out under the official's name. */
  message: z.string().min(1),
  /** One line on why these people and this channel. */
  why: z.string().min(1),
  /**
   * True when the channel cannot be completed from a card (door knocking is
   * drawn on a map), so the only action is the deep link into the full flow.
   */
  deepLinkOnly: z.boolean().default(false),
})
export type OutreachProposal = z.infer<typeof OutreachProposalSchema>

/** A prior send worth looking at, resolved live from the outreach history. */
export const PastOutreachRefSchema = z.object({
  /** Outreach rows to render. Resolved at render, not snapshotted. */
  outreachIds: z.array(z.number().int().positive()).min(1).max(5),
  /** The agent's one-line read of why these matter here. */
  note: z.string().min(1),
})
export type PastOutreachRef = z.infer<typeof PastOutreachRefSchema>

/**
 * Organizations and community leaders worth connecting with on this issue.
 * Modelled on the person contact panel, but for groups a contact file does not
 * hold. Persisted so the card can resolve live and so the official can act on
 * them later.
 */
export const ContactRefSchema = z.object({
  contactIds: z.array(z.string()).min(1).max(5),
  note: z.string().min(1),
})
export type ContactRef = z.infer<typeof ContactRefSchema>

export const ChatCardSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('outreach_proposal') })
    .merge(OutreachProposalSchema),
  z.object({ kind: z.literal('past_outreach') }).merge(PastOutreachRefSchema),
  z.object({ kind: z.literal('contacts') }).merge(ContactRefSchema),
])
export type ChatCard = z.infer<typeof ChatCardSchema>
