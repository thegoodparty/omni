import { z } from 'zod'
import {
  ConstituentRefSchema,
  OutsideContactSchema,
  OutreachProposalSchema,
  OutreachTypeSchema,
  PastOutreachRefSchema,
  ProposalChannelSchema,
} from '@goodparty_org/contracts'
import type { ProposalChannel } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import {
  PastOutreachRow,
  PriorityFlowOutreachService,
} from '../services/priorityFlowOutreach.service'

// The model never writes proposalKey: the server mints it deterministically
// from (conversationId, toolCallId) so the card and the Outreach row it
// becomes agree without the model being trusted with the link.
const presentOutreachProposalInput = OutreachProposalSchema.omit({
  proposalKey: true,
})

// Only a phone banking proposal can be completed from the card. A social post
// has no platform in the proposal shape, and a text lands behind Stripe as an
// unpaid draft, so a Send button on either would promise something that does
// not happen. Derived from the channel rather than read off the model.
const isDeepLinkOnly = (channel: ProposalChannel): boolean =>
  channel !== ProposalChannelSchema.enum.phoneBanking

export const buildPresentOutreachProposalTool = (): LlmStreamTool<
  typeof presentOutreachProposalInput
> => ({
  description:
    'Present a ready-to-send piece of outreach. Everything must be final: ' +
    'the message goes out under their name exactly as you write it, and the ' +
    'audience is the list it will be sent to. Never call this with a sketch, ' +
    'a placeholder, or a message you plan to refine. Build the list and ' +
    'write the copy first, then present once. Only a phoneBanking proposal ' +
    'can be sent from the card itself. A social or text proposal is a ' +
    'recommendation the official finishes elsewhere, so write it that way ' +
    'and never promise them one click. deepLinkOnly is set from the channel ' +
    'whatever you pass, so do not reason about it.',
  inputSchema: presentOutreachProposalInput,
  execute: (input) => ({
    presented: true,
    deepLinkOnly: isDeepLinkOnly(input.channel),
  }),
})

export const buildPresentPastOutreachTool = (): LlmStreamTool<
  typeof PastOutreachRefSchema
> => ({
  description:
    'Show one to five past sends the official should look at, by their ' +
    'outreach ids from read_past_outreach. Use it when what came back last ' +
    'time is the point you are making. The note is your one-line read of ' +
    'why these matter here.',
  inputSchema: PastOutreachRefSchema,
  execute: () => ({ presented: true }),
})

export const buildPresentConstituentsTool = (): LlmStreamTool<
  typeof ConstituentRefSchema
> => ({
  description:
    "Present the official's OWN constituents: people already in their " +
    'contact records, by the contact ids a contact read returned. The ' +
    'neighbour who raised this, the group already running the program, the ' +
    'local leader whose backing would carry it. These are people the ' +
    'problem affects or who can rally others, and the note says in one line ' +
    'why these people and why now. Never use it for someone you found on ' +
    'the web. Somebody outside their records to call about fixing the ' +
    'problem is present_outside_contact.',
  inputSchema: ConstituentRefSchema,
  execute: () => ({ presented: true }),
})

export const buildPresentOutsideContactTool = (): LlmStreamTool<
  typeof OutsideContactSchema
> => ({
  description:
    "Present ONE person or office OUTSIDE the official's records to call " +
    "about the problem: the city attorney's office, the county engineer, " +
    'the state agency desk, the nonprofit that runs the shelter. Built from ' +
    'what you researched, never from a contact id. It is for somebody who ' +
    'can act on the problem; a constituent affected by it is ' +
    'present_constituents. Give the name, their role or organization, one ' +
    'line on why them, who to ask for when the official gets through, and ' +
    'a script they can read down the phone or send as written. Include ' +
    'every contact route you actually found and never invent one. If you ' +
    'found no email, phone or website, say so in prose instead of calling ' +
    'this. Call it once per person, and only when reaching them is the ' +
    'next real step.',
  inputSchema: OutsideContactSchema,
  execute: () => ({ presented: true }),
})

const readPastOutreachInput = z.object({
  channel: OutreachTypeSchema.optional().describe(
    'Limit to one channel. Omit to see every channel.',
  ),
})

export interface ReadPastOutreachOutput {
  priority: PastOutreachRow[]
  office: PastOutreachRow[]
}

export const buildReadPastOutreachTool = (deps: {
  outreach: PriorityFlowOutreachService
  priorityId: string
  organizationSlug: string
}): LlmStreamTool<typeof readPastOutreachInput> => ({
  description:
    "Read what has already gone out. Returns this priority's own sends " +
    "first, then the office's other recent sends for comparison: audience, " +
    'how many people, channel, when it went, and how many replied. Call it ' +
    'before proposing outreach so you can say what came back last time ' +
    'instead of guessing, and quote the numbers you get back rather than ' +
    'describing them vaguely.',
  inputSchema: readPastOutreachInput,
  execute: async ({ channel }): Promise<ReadPastOutreachOutput> => ({
    priority: await deps.outreach.forPriority(deps.priorityId, channel),
    office: await deps.outreach.forOffice(
      deps.organizationSlug,
      deps.priorityId,
      channel,
    ),
  }),
})
