import {
  OutreachProposalSchema,
  ProposalChannelSchema,
} from '@goodparty_org/contracts'
import type { ProposalChannel } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// The model never writes proposalKey: the server mints it deterministically
// from (conversationId, toolCallId) so the card and the Outreach row it
// becomes agree without the model being trusted with the link.
const presentOutreachProposalInput = OutreachProposalSchema.omit({
  proposalKey: true,
})

// What each channel's own flow checks a message against before it will send,
// said to the agent so a proposal opens on a message that already passes.
// SMS mirrors checkSmsStandards (contracts) as the Serve flow applies it:
// the greeting with the first-name token and the opt-out line are added by
// the flow, and the name rule is the one a drafted message kept missing.
export const OUTREACH_MESSAGE_RULES = [
  'WHAT EACH CHANNEL NEEDS IN THE MESSAGE (the outreach flow checks these):',
  '- Text: start with who is texting, signed as the official by first name and office, for example "this is Bryan, your Asheville City Council Member." Never sign as a body or an office alone ("this is the City Council"), and never use a placeholder like [Name] or [your name]. Do not write a greeting or an opt-out line: the flow adds "Hello {{first_name}}," before it and "Reply STOP to opt out" after it. No link shorteners like bit.ly; paste the full web address. Keep it under 300 characters.',
  '- Phone banking: a script a volunteer reads aloud, opening with who they are calling for by the official\'s first name and office, for example "I am calling for Bryan, your Asheville City Council Member." Never a placeholder for the official.',
  "- Social: a post in the official's own voice. No placeholders.",
  '- Door knocking: what to say at the door, in the same voice, naming the official the same way a call does.',
  "- The official's first name and office are in your context. If either is missing, ask before you present, rather than writing a placeholder.",
].join('\n')

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
    'the message goes out under their name exactly as you write it. Never ' +
    'call this with a sketch, a placeholder, or a message you plan to ' +
    'refine. Count the audience with count_contacts and pass that same ' +
    'filter as audienceFilters, with its count and a short listName. Do ' +
    'not save a list first: the list is saved when the official starts ' +
    'the outreach. Pick ONE channel, the one these people are likeliest ' +
    'to answer on given who they are and how they can be reached, and ' +
    'never offer alternatives; if the official wants another, they will ' +
    'say so and you propose again. The card shows only the audience, the ' +
    'count, the channel and a button that opens that channel with ' +
    'everything filled in, where the official reviews and sends it. So say ' +
    'why these people and why this channel once, in your own message, and ' +
    'never promise them one click. deepLinkOnly is set from the channel ' +
    'whatever you pass, so do not reason about it.\n\n' +
    OUTREACH_MESSAGE_RULES,
  inputSchema: presentOutreachProposalInput,
  execute: (input) => ({
    presented: true,
    deepLinkOnly: isDeepLinkOnly(input.channel),
  }),
})
