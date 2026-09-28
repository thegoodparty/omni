import { z } from 'zod'
import {
  ContactRefSchema,
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

export const buildPresentContactsTool = (): LlmStreamTool<
  typeof ContactRefSchema
> => ({
  description:
    'Present organizations and community leaders worth talking to about ' +
    'this priority. Use it when the work needs people rather than a send: ' +
    'the group that already runs the program, the neighbour who raised it, ' +
    'the department head who owns the budget line. The note says in one ' +
    'line why these people and why now.',
  inputSchema: ContactRefSchema,
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
