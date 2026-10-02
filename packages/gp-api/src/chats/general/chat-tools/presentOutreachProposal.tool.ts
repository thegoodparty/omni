import {
  OutreachProposalSchema,
  PRIORITY_GATE_STEPS,
  PRIORITY_STEP_LABELS,
  ProposalChannelSchema,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import type { ProposalChannel } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// The model never writes proposalKey: the server mints it deterministically
// from (conversationId, toolCallId) so the card and the Outreach row it
// becomes agree without the model being trusted with the link.
const priorityProposalInput = OutreachProposalSchema.omit({
  proposalKey: true,
}).extend({
  stepId: OutreachProposalSchema.shape.stepId.describe(
    'The step whose check this outreach puts out: the gate you just settled.',
  ),
  side: OutreachProposalSchema.shape.side.describe(
    'main for the most-affected group, contrast for the least-affected one.',
  ),
})
// Outside a priority there is no check for a send to put out.
const presentOutreachProposalInput = priorityProposalInput.omit({
  stepId: true,
  side: true,
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

const DESCRIPTION =
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
  OUTREACH_MESSAGE_RULES

export const buildPresentOutreachProposalTool = (): LlmStreamTool<
  typeof presentOutreachProposalInput
> => ({
  description: DESCRIPTION,
  inputSchema: presentOutreachProposalInput,
  execute: (input) => ({
    presented: true,
    deepLinkOnly: isDeepLinkOnly(input.channel),
  }),
})

// Why a priority's proposal may not be shown, or null. A side already sent
// is out with people, so offering it again would ask them twice.
export const checkProposalRefusal = (
  input: { stepId?: string; side?: 'main' | 'contrast' },
  status: PriorityStatus,
): string | null => {
  if (input.stepId === undefined && input.side === undefined) return null
  const step = status.steps.find((s) => s.id === input.stepId)
  if (
    step === undefined ||
    input.side === undefined ||
    !PRIORITY_GATE_STEPS.includes(step.id)
  ) {
    return (
      'stepId and side go together, and stepId is the gate whose check ' +
      'this puts out: define, options, method or plan.'
    )
  }
  const sent =
    input.side === 'main' ? step.check?.sentAt : step.check?.contrast?.sentAt
  return sent === undefined
    ? null
    : `That side of the check on ${PRIORITY_STEP_LABELS[step.id]} already ` +
        `went out (${sent}). Do not offer it again; wait for what people say.`
}

// The caller checks a named check with checkProposalRefusal before this runs,
// since it holds the priority.
export const buildPriorityOutreachProposalTool = (): LlmStreamTool<
  typeof priorityProposalInput
> => ({
  description:
    DESCRIPTION +
    '\n\nWhen this puts out a check, pass stepId and side, so the check ' +
    'moves to out on its own once the official sends it.',
  inputSchema: priorityProposalInput,
  execute: (input) => ({
    presented: true,
    deepLinkOnly: isDeepLinkOnly(input.channel),
  }),
})
