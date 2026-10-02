import { ProposalEventSchema } from '../outreach/OutreachEvent.schema'
import { z } from 'zod'
import { SupportStatusRollupSchema } from '../generated/enums'
import {
  PriorityCheckSideSchema,
  PriorityStepIdSchema,
} from '../priorities/PriorityStatus.schema'

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
 * The audience as the filter the agent counted with, so no list is saved
 * until the official starts the outreach. Only what the outreach flows'
 * list builder can show: voter-file booleans, language, income, precincts
 * and support status. Activity conditions and free-text search would build a
 * list the official cannot see before saving, so they are not accepted here.
 */
export const PROPOSAL_AUDIENCE_LIST_KEYS = [
  'languageCodes',
  'incomeRanges',
  'precincts',
  'supportStatus',
] as const

const PROPOSAL_AUDIENCE_LIST_KEY_SET: ReadonlySet<string> = new Set(
  PROPOSAL_AUDIENCE_LIST_KEYS,
)

export const ProposalAudienceFiltersSchema = z
  .record(z.string(), z.union([z.boolean(), z.array(z.string())]))
  .superRefine((filters, ctx) => {
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value) !== PROPOSAL_AUDIENCE_LIST_KEY_SET.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: Array.isArray(value)
            ? `${key} is not a list filter`
            : `${key} takes a list`,
        })
      }
    }
    const status = filters.supportStatus
    if (
      Array.isArray(status) &&
      !status.every((s) => SupportStatusRollupSchema.safeParse(s).success)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['supportStatus'],
        message: 'Unknown support status',
      })
    }
  })
export type ProposalAudienceFilters = z.infer<
  typeof ProposalAudienceFiltersSchema
>

/**
 * A ready-to-send piece of outreach. The agent has counted the audience and
 * written the message; the official finishes it in the channel's own flow.
 *
 * `proposalKey` is minted SERVER-SIDE from the tool call, never by the model,
 * and is what links this card to the Outreach row once one exists. The card
 * resolves by it: nothing found means not sent yet.
 */
export const OutreachProposalSchema = z.object({
  proposalKey: z.string().uuid(),
  event: ProposalEventSchema.optional().describe(
    'For an event invite: the date (YYYY-MM-DD), start time (24-hour HH:MM) ' +
      'and location you know. Write the same details into the message. ' +
      'Leave out any part you do not know; never guess one or leave a ' +
      'placeholder for it.',
  ),
  audience: z.string().min(1),
  count: z.number().int().nonnegative(),
  channel: ProposalChannelSchema,
  /** A list saved before the card. Cards written before audienceFilters. */
  savedFilterId: z.number().int().positive().nullish(),
  /** The audience, unsaved. The flow saves it when the official confirms. */
  audienceFilters: ProposalAudienceFiltersSchema.optional(),
  listName: z.string().nullish(),
  /** What goes out under the official's name. */
  message: z.string().min(1),
  /**
   * Nothing shows this: the agent says why in its message. Kept so cards
   * already persisted with it still parse.
   */
  why: z.string().min(1).optional(),
  /**
   * True when the channel cannot be completed from a card (door knocking is
   * drawn on a map), so the only action is the deep link into the full flow.
   */
  deepLinkOnly: z.boolean().default(false),
  /**
   * The check this outreach puts out, on a priority: the gate step and which
   * side of it. A real send moves that side to out.
   */
  stepId: PriorityStepIdSchema.optional(),
  side: PriorityCheckSideSchema.optional(),
})
export type OutreachProposal = z.infer<typeof OutreachProposalSchema>

/**
 * What a channel's own create carries when a proposal card handed the
 * official into it: the card's derived key, so a second completion returns
 * the first outreach instead of making another, and the priority it was
 * proposed under, with the check on it that the send puts out. All optional,
 * because the same create serves every other way into the flow.
 */
export const ProposalLinkSchema = z.object({
  proposalKey: z.string().uuid().optional(),
  priorityId: z.string().min(1).optional(),
  stepId: PriorityStepIdSchema.optional(),
  side: PriorityCheckSideSchema.optional(),
})
export type ProposalLink = z.infer<typeof ProposalLinkSchema>

/**
 * Opens the hidden turn the app sends when the official finishes outreach a
 * card opened, so the agent hears about the send and the transcript can
 * leave it out. The proposal key follows it, so a reload sends it once.
 */
export const PROPOSAL_SENT_MARKER = '[Sent from a card]'

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
