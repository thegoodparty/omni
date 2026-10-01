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
  'constituents',
  'outside_contact',
] as const

export const ChatCardKindSchema = z.enum(CHAT_CARD_KINDS)
export type ChatCardKind = z.infer<typeof ChatCardKindSchema>

/**
 * Channels a proposal can be made on. Only phone banking is sent from the
 * card; the rest deep-link into their own flow. Append only: the channel is
 * persisted in the tool args of segments that already exist.
 */
export const PROPOSAL_CHANNELS = [
  'social',
  'phoneBanking',
  'text',
  'doorKnocking',
] as const
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

/**
 * What a channel's own create carries when a proposal card handed the
 * official into it: the card's derived key, so a second completion returns
 * the first outreach instead of making another, and the priority it was
 * proposed under. Both optional, because the same create serves every other
 * way into the flow.
 */
export const ProposalLinkSchema = z.object({
  proposalKey: z.string().uuid().optional(),
  priorityId: z.string().min(1).optional(),
})
export type ProposalLink = z.infer<typeof ProposalLinkSchema>

/** A prior send worth looking at, resolved live from the outreach history. */
export const PastOutreachRefSchema = z.object({
  /** Outreach rows to render. Resolved at render, not snapshotted. */
  outreachIds: z.array(z.number().int().positive()).min(1).max(5),
  /** The agent's one-line read of why these matter here. */
  note: z.string().min(1),
})
export type PastOutreachRef = z.infer<typeof PastOutreachRefSchema>

/**
 * People already in the office's own CRM: the neighbour who raised the issue,
 * the group that already runs the program. Ids only, so the card resolves live
 * against whatever the record says today.
 */
export const ConstituentRefSchema = z.object({
  contactIds: z.array(z.string()).min(1).max(5),
  note: z.string().min(1),
})
export type ConstituentRef = z.infer<typeof ConstituentRefSchema>

/**
 * The name this schema shipped under. Kept exported because the tool name it
 * backs (`present_contacts`) is persisted on segments that already exist.
 */
export const ContactRefSchema = ConstituentRefSchema
export type ContactRef = ConstituentRef

/**
 * Somebody to reach who is NOT in our data: an attorney's office, a county
 * engineer, an agency desk, a community organization the agent found while
 * researching. Nothing here resolves, because there is nothing to resolve
 * against, so unlike every other card this one is a snapshot of what the
 * agent found.
 *
 * At least one of `email`, `phone` and `url` is what makes it a card rather
 * than a sentence, and the tool that carries it says so. A card that arrives
 * with none of them still renders its script to copy.
 */
export const OutsideContactSchema = z.object({
  name: z.string().min(1),
  /** Their role, or the organization they are part of. */
  role: z.string().min(1),
  /** One line on why this is the person to reach. */
  why: z.string().min(1),
  /** Who to ask for once the official gets through. */
  askFor: z.string().min(1),
  /** What to say, ready to read down the phone or send as-is. */
  script: z.string().min(1),
  email: z.string().email().nullish(),
  phone: z.string().min(1).nullish(),
  // Rejects `javascript:`, which a bare URL check accepts and which reaches
  // an href.
  url: z.url({ protocol: /^https?$/ }).nullish(),
})
export type OutsideContact = z.infer<typeof OutsideContactSchema>

export const ChatCardSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('outreach_proposal') })
    .merge(OutreachProposalSchema),
  z.object({ kind: z.literal('past_outreach') }).merge(PastOutreachRefSchema),
  z.object({ kind: z.literal('constituents') }).merge(ConstituentRefSchema),
  z.object({ kind: z.literal('outside_contact') }).merge(OutsideContactSchema),
])
export type ChatCard = z.infer<typeof ChatCardSchema>
