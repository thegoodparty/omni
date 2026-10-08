import {
  OutreachProposalSchema,
  PRIORITY_GATE_STEPS,
  PRIORITY_STEP_LABELS,
  ProposalChannelSchema,
  SMS_COMPOSED_MAX_LENGTH,
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
// Outside a priority there is no check for a send to put out, and so no
// earlier sample of one to widen.
const presentOutreachProposalInput = priorityProposalInput.omit({
  stepId: true,
  side: true,
  widensOutreachIds: true,
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

// The model kept building the last item of a numbered list it had just
// written when the user picked "#1": the item it wrote most about wins.
export const PICKED_OPTION_RULE =
  '- When the user picks from a list you gave earlier, by number or by name ("#1", "the first one", "the survey one"), go back to that list and build exactly that item, even if you wrote more about a later one. Name the item in a few words before you call the tool, so a wrong pick shows before the card does.'

// Only a phone banking proposal can be completed from the card. A social post
// has no platform in the proposal shape, and a text lands behind Stripe as an
// unpaid draft, so a Send button on either would promise something that does
// not happen. Derived from the channel rather than read off the model.
const isDeepLinkOnly = (channel: ProposalChannel): boolean =>
  channel !== ProposalChannelSchema.enum.phoneBanking

// The card and the list both read a sample this big as the whole audience,
// so the agent has to say it that way too. A post has no audience, so only
// the other channels can come up empty.
export const proposalResult = (input: {
  channel: ProposalChannel
  count: number
  sampleSize?: number
}) =>
  input.count === 0 && input.channel !== 'social'
    ? {
        error:
          'That audience counted nobody, so there is no one to send this ' +
          'to. Loosen or change the filter, count again, and present it ' +
          'once it reaches people.',
      }
    : {
        presented: true,
        deepLinkOnly: isDeepLinkOnly(input.channel),
        ...(input.sampleSize !== undefined &&
          input.count > 0 &&
          input.sampleSize >= input.count && {
            wholeAudience:
              `The sample is no smaller than the ${input.count} people in ` +
              'the audience, so all of them get it. Say so.',
          }),
      }

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
  execute: proposalResult,
})

// Win's text, as its own flow composes it: the greeting merges Peerly's
// single-brace token, and the flow appends the "Paid for by" and opt-out
// lines. The identification mirrors identificationIntro in the webapp's
// smsCompose.util.ts, which a Win text's compliance check looks for.
export const WIN_TEXT_MESSAGE_RULES = [
  'WHAT THE TEXT NEEDS (the text flow checks these):',
  '- Start with who is texting: the candidate by first name and the office they are running for, for example "this is Renee, candidate for Asheville City Council." Never a placeholder like [Name] or [your name].',
  '- Do not write a greeting, a "Paid for by" line or an opt-out line: the flow adds "Hello {first_name}," before the message, and the "Paid for by" and "Reply STOP to opt out" lines after it.',
  '- No link shorteners like bit.ly; paste the full web address.',
  `- Keep it under 300 characters. The whole text, with the lines the flow adds, has to stay under ${SMS_COMPOSED_MAX_LENGTH}.`,
  "- The candidate's first name and office are in your context. If either is missing, ask before you present, rather than writing a placeholder.",
].join('\n')

const WIN_DESCRIPTION =
  'Present a ready-to-send text to voters as a card. Everything must be ' +
  "final: the text goes out under the candidate's name exactly as you " +
  'write it. Never call this with a sketch, a placeholder, or a message ' +
  'you plan to refine. Count the voters with a cell phone with ' +
  'count_contacts and pass that same filter as audienceFilters, with its ' +
  'count and a short listName. Do not save a list first: the list is ' +
  'saved when the candidate starts the text from the card. channel is ' +
  'always text: this card cannot carry phone banking, door knocking or a ' +
  'social post, so describe those in your reply instead. The card shows ' +
  'only the audience, the count, the channel and a button that opens ' +
  "Voter Outreach's text flow with everything filled in, where the " +
  'candidate reviews, pays for and sends it. So say why these voters ' +
  'once, in your own message, and never promise them one click. ' +
  'deepLinkOnly is set from the channel whatever you pass, so do not ' +
  'reason about it.\n\n' +
  WIN_TEXT_MESSAGE_RULES

// Win's text flow is the only one that opens on a card's audience today, so
// any other channel would hand the candidate a button into a flow that drops
// what the card proposed.
export const buildCampaignManagerOutreachProposalTool = (): LlmStreamTool<
  typeof presentOutreachProposalInput
> => ({
  description: WIN_DESCRIPTION,
  inputSchema: presentOutreachProposalInput,
  execute: (input) =>
    input.channel === ProposalChannelSchema.enum.text
      ? proposalResult(input)
      : {
          error:
            'Only a text can be presented here. Describe phone banking, ' +
            'door knocking or a social post in your reply instead, ' +
            'without a card.',
        },
})

// Why a priority's proposal may not be shown, or null. A side already sent
// is out with people, so offering it again would ask them twice.
// A side that went out can be asked again only as a wider sample: a proposal
// whose widensOutreachIds the caller has checked are sends of that same side
// (`widensVerified`), so its list leaves out everyone they already reached.
export const checkProposalRefusal = (
  input: {
    stepId?: string
    side?: 'main' | 'contrast'
    widensOutreachIds?: number[]
  },
  status: PriorityStatus,
  widensVerified = false,
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
  if (input.widensOutreachIds?.length && !widensVerified) {
    return (
      'widensOutreachIds has to name sends that put out this same side of ' +
      `the check on ${PRIORITY_STEP_LABELS[step.id]}. Take the ids from ` +
      'read_past_outreach.'
    )
  }
  const sent =
    input.side === 'main' ? step.check?.sentAt : step.check?.contrast?.sentAt
  return sent === undefined || widensVerified
    ? null
    : `That side of the check on ${PRIORITY_STEP_LABELS[step.id]} already ` +
        `went out (${sent}). Do not offer it again; wait for what people ` +
        'say. If what came back is too thin to read, widen it with ' +
        'widensOutreachIds set to the sends that went out.'
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
  execute: proposalResult,
})
