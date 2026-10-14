import {
  BUILD_CITIZENS_PANEL_PURPOSE,
  CIVIC_PANEL_LEAVE_LINE,
  isCivicPanelOnlyList,
  OutreachProposalSchema,
  PANEL_SEED_SAMPLE_SIZE,
  PRIORITY_GATE_STEPS,
  PRIORITY_LISTEN_GATES,
  PRIORITY_STEP_LABELS,
  ProposalChannelSchema,
  SMS_COMPOSED_MAX_LENGTH,
  type PriorityStatus,
} from '@goodparty_org/contracts'
import type { ProposalChannel } from '@goodparty_org/contracts'
import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// The model never writes proposalKey: the server mints it deterministically
// from (conversationId, toolCallId) so the card and the Outreach row it
// becomes agree without the model being trusted with the link. A purpose is
// offered only on the Chief of Staff's panel invite, below.
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
// The civic panel parts and the report back, offered only on a priority
// and only behind serve-citizen-panels.
const priorityProposalInputWithoutPanel = priorityProposalInput.omit({
  civicPanelAsk: true,
  panelSampleSize: true,
  reportBackForOutreachId: true,
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
  `- Text: start with who is texting, signed as the official by first name and office, for example "this is Bryan, your Asheville City Council Member." Never sign as a body or an office alone ("this is the City Council"), and never use a placeholder like [Name] or [your name]. Do not write a greeting or an opt-out line: the flow adds "Hello {{first_name}}," before it and "Reply STOP to opt out" after it. A text to civic panel members alone also gets "${CIVIC_PANEL_LEAVE_LINE}" from the flow, so never write how to leave the panel. No link shorteners like bit.ly; paste the full web address. Keep it under 300 characters.`,
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

// The Chief of Staff's card behind serve-citizen-panels, with texting on: it
// can also be the civic panel invite, the one text that carries a
// purpose, so the flow opens on it with the join line locked.
const chiefOfStaffPanelProposalInput = presentOutreachProposalInput.extend({
  civicPanelAsk: OutreachProposalSchema.shape.civicPanelAsk,
  purpose: z
    .literal(BUILD_CITIZENS_PANEL_PURPOSE)
    .optional()
    .describe(
      'Only for the invite that builds the civic panel. Leave it out ' +
        'for every other piece of outreach.',
    ),
})
type ChiefOfStaffPanelProposalInput = z.infer<
  typeof chiefOfStaffPanelProposalInput
>

// Why a Chief of Staff proposal's civic panel part cannot be shown, or
// null. The invite goes once, to a random group of the district's cell
// phones sized for about 100 members, with the join ask on.
export const checkPanelInvite = (
  input: Pick<
    ChiefOfStaffPanelProposalInput,
    | 'channel'
    | 'purpose'
    | 'civicPanelAsk'
    | 'audienceFilters'
    | 'savedFilterId'
    | 'count'
    | 'sampleSize'
  >,
  panel: { members: number; inviteSent: boolean },
): string | null => {
  if (input.purpose === undefined) {
    return input.civicPanelAsk
      ? 'civicPanelAsk is only for the invite that builds the civic ' +
          `panel. Set purpose to ${BUILD_CITIZENS_PANEL_PURPOSE} for that, ` +
          'or leave civicPanelAsk out.'
      : null
  }
  if (panel.members > 0) {
    return (
      `They already have ${panel.members} people on their civic panel, ` +
      'so do not invite again. Tell them so.'
    )
  }
  if (panel.inviteSent) {
    return (
      'Their civic panel invite already went out, so do not send ' +
      'another. Tell them so: people join as they reply JOIN.'
    )
  }
  if (input.channel !== 'text') {
    return 'The civic panel invite is a text. Set channel to text.'
  }
  if (input.civicPanelAsk !== true) {
    return (
      'The civic panel invite asks people to join. Set civicPanelAsk ' +
      'to true and present again.'
    )
  }
  if (input.savedFilterId != null) {
    return (
      "The civic panel invite goes to a random group of the district's " +
      'cell phones, never a saved list. Leave savedFilterId out and present ' +
      'again.'
    )
  }
  // The district's cell phones and nothing narrower, so the panel looks like
  // the district rather than like any one list.
  const filters = input.audienceFilters ?? {}
  if (Object.keys(filters).length !== 1 || filters.hasCellPhone !== true) {
    return (
      'The civic panel invite goes to everyone in the district with a ' +
      'cell phone. Count with { hasCellPhone: true } and nothing else, and ' +
      'pass that as audienceFilters.'
    )
  }
  const sendTo = Math.min(PANEL_SEED_SAMPLE_SIZE, input.count)
  if (input.sampleSize !== sendTo) {
    return (
      `Set sampleSize to ${sendTo}, the number size_panel_invite returned ` +
      'for this count, and present again.'
    )
  }
  return null
}

export const buildChiefOfStaffOutreachProposalTool = (panel: {
  members: number
  inviteSent: boolean
}): LlmStreamTool<typeof chiefOfStaffPanelProposalInput> => ({
  description:
    DESCRIPTION +
    '\n\nFor the invite that builds the civic panel, set purpose to ' +
    `${BUILD_CITIZENS_PANEL_PURPOSE} and civicPanelAsk to true. The flow ` +
    'adds the line asking people to reply JOIN and locks it, so never write ' +
    'that ask or how to join into the message.',
  inputSchema: chiefOfStaffPanelProposalInput,
  execute: (input) => {
    const refusal = checkPanelInvite(input, panel)
    return refusal === null ? proposalResult(input) : { error: refusal }
  },
})

// Win's text, as its own flow composes it: the greeting merges Peerly's
// single-brace token, and the flow appends the "Paid for by" and opt-out
// lines. The identification mirrors identificationIntro in the webapp's
// smsCompose.util.ts, which a Win text's compliance check looks for.
// A call or a door is read live by a volunteer, so neither carries the
// lines a text's compliance check adds.
export const WIN_OUTREACH_MESSAGE_RULES = [
  'WHAT EACH CHANNEL NEEDS IN THE MESSAGE (the outreach flow checks these):',
  '- Text: start with who is texting: the candidate by first name and the office they are running for, for example "this is Renee, candidate for Asheville City Council." Never a placeholder like [Name] or [your name]. Do not write a greeting, a "Paid for by" line or an opt-out line: the flow adds "Hello {first_name}," before the message, and the "Paid for by" and "Reply STOP to opt out" lines after it. No link shorteners like bit.ly; paste the full web address. ' +
    `Keep it under 300 characters. The whole text, with the lines the flow adds, has to stay under ${SMS_COMPOSED_MAX_LENGTH}.`,
  '- Phone banking: a script a volunteer reads aloud, opening with who they are calling for by the candidate\'s first name and office, for example "I am calling for Renee, candidate for Asheville City Council." No "Paid for by" or opt-out line.',
  "- Social: a post in the candidate's own voice. No placeholders.",
  '- Door knocking: what to say at the door, in the same voice, naming the candidate the same way a call does.',
  "- The candidate's first name and office are in your context. If either is missing, ask before you present, rather than writing a placeholder.",
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

export const buildCampaignManagerOutreachProposalTool = (): LlmStreamTool<
  typeof presentOutreachProposalInput
> => ({
  description: WIN_DESCRIPTION,
  inputSchema: presentOutreachProposalInput,
  execute: proposalResult,
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

// Why a proposal's panel part cannot be shown, or null. One send asks the
// panel and a fresh sample together, so the panel part only makes sense as
// part of a text sample, with the join ask on for the fresh residents.
export const checkPanelPart = (input: {
  channel: ProposalChannel
  civicPanelAsk?: boolean
  panelSampleSize?: number
  sampleSize?: number
  widensOutreachIds?: number[]
  audienceFilters?: Record<string, unknown>
}): string | null => {
  if (input.channel !== 'text' && input.civicPanelAsk) {
    return 'civicPanelAsk is for a text only. Leave it out and present again.'
  }
  // A send to the panel alone carries the LEAVE line, and never both lines.
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
  if (input.panelSampleSize === undefined) return null
  if (input.channel !== 'text') {
    return 'panelSampleSize is for a text only. Leave it out and present again.'
  }
  // The card would say who it asks without the people it leaves out.
  if (input.widensOutreachIds?.length) {
    return (
      'A send to the panel and new residents does not widen an earlier ' +
      'sample. Use panelSampleSize or widensOutreachIds, not both, and ' +
      'present again.'
    )
  }
  if (
    input.sampleSize === undefined ||
    input.panelSampleSize >= input.sampleSize
  ) {
    return (
      'sampleSize is the whole send: the panel part plus as many residents ' +
      'not on the panel, so twice panelSampleSize. A send of panel members ' +
      'alone invites nobody new to join. Set sampleSize that way and ' +
      'present again.'
    )
  }
  if (input.civicPanelAsk !== true) {
    return (
      'A send that asks the panel and new residents together also asks the ' +
      'new ones to join. Set civicPanelAsk to true and present again.'
    )
  }
  return null
}

// The caller checks a named check with checkProposalRefusal before this runs,
// since it holds the priority.
export const buildPriorityOutreachProposalTool = (options: {
  citizenPanels: boolean
}): LlmStreamTool<z.ZodType<z.infer<typeof priorityProposalInput>>> => ({
  description:
    DESCRIPTION +
    '\n\nWhen this puts out a check, pass stepId and side, so the check ' +
    'moves to out on its own once the official sends it.',
  // The schema without the panel parts parses into the same shape with them
  // absent, so one execute serves both.
  inputSchema: options.citizenPanels
    ? priorityProposalInput
    : priorityProposalInputWithoutPanel,
  execute: proposalResult,
})
