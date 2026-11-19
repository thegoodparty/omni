import {
  isCivicPanelOnlyList,
  OutreachProposalSchema,
  PRIORITY_GATE_STEPS,
  PRIORITY_LISTEN_GATES,
  PRIORITY_STEP_LABELS,
  MIN_TEXTS_PER_ROUND,
  ProposalChannelSchema,
  SMS_COMPOSED_MAX_LENGTH,
  type PriorityReadStatus,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import type { ProposalChannel } from '@goodparty_org/contracts'
import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// The model never writes proposalKey: the server mints it deterministically
// from (conversationId, toolCallId) so the card and the Outreach row it
// becomes agree without the model being trusted with the link.
const priorityProposalInput = OutreachProposalSchema.omit({
  proposalKey: true,
  purpose: true,
}).extend({
  stepId: OutreachProposalSchema.shape.stepId.describe(
    'The step whose check this outreach puts out: the gate you just settled.',
  ),
  side: OutreachProposalSchema.shape.side.describe(
    'main for the most-affected group, contrast for the least-affected one.',
  ),
})
// The civic panel ask, the report back, the follow-up size and the unreached
// area, offered only on a priority and only behind serve-citizen-panels.
const priorityProposalInputWithoutPanel = priorityProposalInput.omit({
  civicPanelAsk: true,
  reportBackForOutreachId: true,
  roundTwoSize: true,
  areaTarget: true,
})
// Outside a priority there is no check for a send to put out, and so no
// earlier sample of one to widen.
const presentOutreachProposalInput = priorityProposalInputWithoutPanel.omit({
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
  `- Text: start with who is texting, signed as the official by full name and office, for example "this is Bryan Ortiz, your Asheville City Council Member." Never the first name alone. Never sign as a body or an office alone ("this is the City Council"), and never use a placeholder like [Name] or [your name]. Do not write a greeting or an opt-out line: the flow adds "Hello {{first_name}}," before it and "Reply STOP to opt out" after it. No link shorteners like bit.ly; paste the full web address. Keep it under 300 characters.`,
  '- Phone banking: a script a volunteer reads aloud, opening with who they are calling for by the official\'s full name and office, for example "I am calling for Bryan Ortiz, your Asheville City Council Member." Never a placeholder for the official.',
  "- Social: a post in the official's own voice. No placeholders.",
  '- Door knocking: what to say at the door, in the same voice, naming the official the same way a call does.',
  "- The official's full name and office are in your context. If either is missing, ask before you present, rather than writing a placeholder.",
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
// A call or a door is read live by a volunteer, so neither carries the
// lines a text's compliance check adds.
export const WIN_OUTREACH_MESSAGE_RULES = [
  'WHAT EACH CHANNEL NEEDS IN THE MESSAGE (the outreach flow checks these):',
  '- Text: start with who is texting: the candidate by full name and the office they are running for, for example "this is Renee Diaz, candidate for Asheville City Council." Never a placeholder like [Name] or [your name]. Do not write a greeting, a "Paid for by" line or an opt-out line: the flow adds "Hello {first_name}," before the message, and the "Paid for by" and "Reply STOP to opt out" lines after it. No link shorteners like bit.ly; paste the full web address. ' +
    `Keep it under 300 characters. The whole text, with the lines the flow adds, has to stay under ${SMS_COMPOSED_MAX_LENGTH}.`,
  '- Phone banking: a script a volunteer reads aloud, opening with who they are calling for by the candidate\'s first name and office, for example "I am calling for Renee, candidate for Asheville City Council." No "Paid for by" or opt-out line.',
  "- Social: a post in the candidate's own voice. No placeholders.",
  '- Door knocking: what to say at the door, in the same voice, naming the candidate the same way a call does.',
  "- The candidate's name and office are in your context. If either is missing, ask before you present, rather than writing a placeholder.",
].join('\n')

const WIN_DESCRIPTION =
  'Present a ready-to-send piece of outreach to voters as a card. ' +
  'Everything must be final: the message goes out under the ' +
  "candidate's name exactly as you write it. Never call this with a " +
  'sketch, a placeholder, or a message you plan to refine. Count the ' +
  'voters with count_contacts and pass that same filter as ' +
  'audienceFilters, with its count and a short listName; for a text, ' +
  'count only voters with a cell phone. Do not save a list first: the ' +
  'list is saved when the candidate starts the outreach from the card. ' +
  'Pick ONE channel, the one these voters are likeliest to answer on ' +
  'given who they are and how they can be reached, and never offer ' +
  'alternatives; if the candidate wants another, they will say so and ' +
  'you propose again. The card shows only the audience, the count, the ' +
  "channel and a button that opens that channel's Voter Outreach flow " +
  'with everything filled in, where the candidate reviews and sends it ' +
  '(and pays, for a text). So say why these voters and why this channel ' +
  'once, in your own message, and never promise them one click. ' +
  'deepLinkOnly is set from the channel whatever you pass, so do not ' +
  'reason about it.\n\n' +
  WIN_OUTREACH_MESSAGE_RULES

export const buildCampaignManagerOutreachProposalTool = (
  options: { textingClosed: boolean } = { textingClosed: false },
): LlmStreamTool<typeof presentOutreachProposalInput> => ({
  description: WIN_DESCRIPTION,
  inputSchema: presentOutreachProposalInput,
  execute: (input) =>
    options.textingClosed && input.channel === ProposalChannelSchema.enum.text
      ? {
          error:
            'Texting is closed for this race: the deadline to get verified ' +
            'for texting has passed. Pick door knocking, phone banking or a ' +
            'social post instead and present again.',
        }
      : proposalResult(input),
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
    const gate = step ? PRIORITY_LISTEN_GATES[step.id] : undefined
    if (step && gate !== undefined) {
      return (
        `${step.id} is where the answers land, not the check. ` +
        `Present it again with stepId ${gate}, the same side and everything ` +
        'else unchanged.'
      )
    }
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

// Why a proposal's civic panel ask cannot be shown, or null. A send to the
// panel alone never carries the join ask.
export const checkPanelPart = (input: {
  channel: ProposalChannel
  civicPanelAsk?: boolean
  audienceFilters?: Record<string, unknown>
}): string | null => {
  if (input.channel !== 'text' && input.civicPanelAsk) {
    return 'civicPanelAsk is for a text only. Leave it out and present again.'
  }
  if (
    input.civicPanelAsk &&
    input.audienceFilters !== undefined &&
    isCivicPanelOnlyList(input.audienceFilters)
  ) {
    return (
      'Everyone this text reaches is already on the civic panel, so it ' +
      'does not ask them to join. Leave civicPanelAsk out and present again.'
    )
  }
  return null
}

// Why a priority's text cannot be shown given its follow-up, or null. Once a
// follow-up text is paid for the check has had its two texts, so a short read
// is closed with doors and calls and never a third text. roundTwoSize is the
// held half of the first text's purchase and only ever comes from
// size_round_one, so it is checked against the split that tool makes.
export const checkFollowUpPart = (
  input: {
    channel: ProposalChannel
    sampleSize?: number
    roundTwoSize?: number
    widensOutreachIds?: number[]
  },
  read: Pick<PriorityReadStatus, 'followUp' | 'followUpSent'> = {},
): string | null => {
  if (input.channel === 'text') {
    if (read.followUp) {
      return (
        `The follow-up text to ${read.followUp.texts} people is already ` +
        `scheduled for ${read.followUp.scheduledLocalDate}. Do not present ` +
        'another text. If more than that is needed, present doors and calls ' +
        'aimed at the groups still missing.'
      )
    }
    if (read.followUpSent) {
      return (
        'The follow-up text already went out, and a check gets no third ' +
        'text. Present doors and calls aimed at the groups still missing ' +
        'instead.'
      )
    }
  }
  if (input.roundTwoSize === undefined) return null
  if (input.channel !== 'text') {
    return 'roundTwoSize is for a text only. Leave it out and present again.'
  }
  if (input.sampleSize === undefined || input.widensOutreachIds?.length) {
    return (
      'roundTwoSize goes only on the first text of a check, with its ' +
      'sampleSize and no widensOutreachIds. Leave it out and present again.'
    )
  }
  if (
    input.roundTwoSize < MIN_TEXTS_PER_ROUND ||
    input.roundTwoSize > input.sampleSize ||
    input.roundTwoSize < input.sampleSize - 1
  ) {
    return (
      'roundTwoSize is not the split size_round_one returned beside ' +
      'sampleSize. Present it again with both exactly as returned, or ' +
      'leave roundTwoSize out.'
    )
  }
  return null
}

// The caller checks a named check with checkProposalRefusal before this runs,
// since it holds the priority.
// A priority text puts every call to action at the bottom: the question,
// then how to reply, then the lines the flow adds under it.
export const PRIORITY_TEXT_LAYOUT_RULE =
  'A text that puts out a check ends with the question, then, as its own ' +
  'last line, how to reply, like "Reply YES or NO." or whatever fits the ' +
  'question. Write nothing after that line: the flow adds the opt-out ' +
  'right under it.'

export const buildPriorityOutreachProposalTool = (options: {
  citizenPanels: boolean
}): LlmStreamTool<z.ZodType<z.infer<typeof priorityProposalInput>>> => ({
  description:
    DESCRIPTION +
    '\n\nWhen this puts out a check, pass stepId and side, so the check ' +
    'moves to out on its own once the official sends it. ' +
    PRIORITY_TEXT_LAYOUT_RULE,
  // The schema without the panel parts parses into the same shape with them
  // absent, so one execute serves both.
  inputSchema: options.citizenPanels
    ? priorityProposalInput
    : priorityProposalInputWithoutPanel,
  execute: proposalResult,
})
