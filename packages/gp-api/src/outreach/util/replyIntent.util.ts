import {
  CIVIC_PANEL_JOIN_KEYWORD,
  CIVIC_PANEL_LEAVE_KEYWORD,
} from '@goodparty_org/contracts'
import type {
  DecisionAnswers,
  DecisionRequest,
  YesNoAnswer,
  YesNoQuestion,
} from '@/decisionModels/schemas/decisionQuestions.schema'
import { isCivicPanelJoinMessage } from './civicPanelJoin.util'
import { isCivicPanelLeaveMessage } from './civicPanelLeave.util'
import { isOptOutMessage } from './textOptOut.util'

// What a reply is asking for, label by label. replyIntent.eval.ts scores
// it against invented replies on either reader.

export const REPLY_INTENT_LABELS = [
  'optOut',
  'civicPanelJoin',
  'civicPanelLeave',
] as const

export type ReplyIntentLabel = (typeof REPLY_INTENT_LABELS)[number]

export interface LabelAnswer {
  value: boolean
  probabilities?: { true: number; false: number }
}

export type ReplyIntent = Record<ReplyIntentLabel, LabelAnswer>

// A label is true at or above this P(yes). Kept separate from the decision
// client's own cut so an uncertain band to review can sit around it later.
export const REPLY_INTENT_YES_THRESHOLD = 0.5

// The regex is the floor for opt-out: a reply it reads as an opt-out stays
// one whatever the model says, with at least this P(yes).
export const OPT_OUT_FLOOR_PROBABILITY = 0.99

// Where the words came from. A text or email reply is the person's own; a
// door or call note is a canvasser's account of what the person said.
export type ReplyChannel = 'text' | 'email' | 'door' | 'call'

const ORGANIZATION =
  "an organization, such as a candidate's campaign or a local government " +
  'office'

const SOURCE: Record<ReplyChannel, string> = {
  text: `This is a text message a person sent in reply to a text from ${ORGANIZATION}.`,
  email: `This is an email a person sent in reply to an email from ${ORGANIZATION}.`,
  door:
    'This is a note a canvasser wrote about what a person said at their ' +
    `door, during a visit for ${ORGANIZATION}.`,
  call:
    'This is a note a caller wrote about what a person said on a phone ' +
    `call from ${ORGANIZATION}.`,
}

const contextFor = (channel: ReplyChannel): string =>
  `${SOURCE[channel]} Read what the person wants, not how they feel about ` +
  'the organization.'

export const replyIntentQuestions = (
  channel: ReplyChannel,
): Record<ReplyIntentLabel, YesNoQuestion> => {
  const context = contextFor(channel)
  return {
    optOut: {
      type: 'yesNo',
      instructions:
        `${context} Is the person asking the organization to stop ` +
        'contacting them? Answer yes for any wording that asks to stop, ' +
        'unsubscribe, opt out, be removed from the list or not be ' +
        'contacted again, including a bare STOP, END, CANCEL, QUIT or ' +
        'UNSUBSCRIBE. Answer no when the person disagrees, complains or ' +
        'criticizes without asking to stop the contact, or uses a word ' +
        'like "stop" or "end" about something else, such as noise, a ' +
        'project or a policy.',
      trueDescription:
        'The person is asking not to be contacted again by this sender.',
      falseDescription:
        'The person is not asking to stop the contact, even if what they ' +
        'said is negative or asks for something else to stop.',
    },
    civicPanelJoin: {
      type: 'yesNo',
      instructions:
        `${context} The organization may have invited the person to join ` +
        'a civic panel, a group of people it texts now and then to ask ' +
        'their views. Is the person saying they want to join that panel? ' +
        `Answer yes for a reply of ${CIVIC_PANEL_JOIN_KEYWORD} or a clear ` +
        'yes to being added. Answer no when the person is talking about ' +
        'joining something else, such as a meeting or an event, asks a ' +
        'question without agreeing, or declines.',
      trueDescription: 'The person agrees to join the civic panel.',
      falseDescription:
        'The person does not agree to join the civic panel, or is talking ' +
        'about something else.',
    },
    civicPanelLeave: {
      type: 'yesNo',
      instructions:
        `${context} The person may be a member of the organization's ` +
        'civic panel, a group of people it texts now and then to ask ' +
        'their views. Is the person saying they want to leave that panel? ' +
        `Answer yes for a reply of ${CIVIC_PANEL_LEAVE_KEYWORD} or a clear ` +
        'request to be taken off the panel. Answer no when the person is ' +
        'talking about leaving something else, such as a meeting, a job ' +
        'or a town, and when they ask to stop all contact without ' +
        'mentioning the panel.',
      trueDescription: 'The person asks to leave the civic panel.',
      falseDescription:
        'The person does not ask to leave the civic panel, or is talking ' +
        'about something else.',
    },
  }
}

type ReplyIntentQuestions = ReturnType<typeof replyIntentQuestions>

export type ReplyIntentDecide = (
  request: DecisionRequest<ReplyIntentQuestions>,
) => Promise<{ answers: DecisionAnswers<ReplyIntentQuestions> }>

const fromModel = (answer: YesNoAnswer): LabelAnswer => ({
  value: answer.probabilities.true >= REPLY_INTENT_YES_THRESHOLD,
  probabilities: {
    true: answer.probabilities.true,
    false: answer.probabilities.false,
  },
})

const withOptOutFloor = (answer: YesNoAnswer): LabelAnswer => {
  const yes = Math.max(answer.probabilities.true, OPT_OUT_FLOOR_PROBABILITY)
  return { value: true, probabilities: { true: yes, false: 1 - yes } }
}

/**
 * With no decision client this is exactly the three regex predicates, on
 * every channel. With one, the model decides each label, except that a
 * regex opt-out is never overruled. An empty reply never reaches the model.
 */
export const classifyReplyIntent = async (
  text: string | null | undefined,
  decide: ReplyIntentDecide | null,
  channel: ReplyChannel = 'text',
): Promise<ReplyIntent> => {
  const regexOptOut = isOptOutMessage(text)
  if (!decide || !text?.trim()) {
    return {
      optOut: { value: regexOptOut },
      civicPanelJoin: { value: isCivicPanelJoinMessage(text) },
      civicPanelLeave: { value: isCivicPanelLeaveMessage(text) },
    }
  }
  const { answers } = await decide({
    input: text,
    questions: replyIntentQuestions(channel),
  })
  return {
    optOut: regexOptOut
      ? withOptOutFloor(answers.optOut)
      : fromModel(answers.optOut),
    civicPanelJoin: fromModel(answers.civicPanelJoin),
    civicPanelLeave: fromModel(answers.civicPanelLeave),
  }
}
