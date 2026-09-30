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
