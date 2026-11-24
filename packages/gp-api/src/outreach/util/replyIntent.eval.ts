import { defineExpectedResultEvalSuite } from '@goodparty_org/judge'
import { z } from 'zod'
import {
  decisionModelApiKey,
  decisionModelProvider,
} from '@/decisionModels/decisionModels.config'
import { DecisionModelService } from '@/decisionModels/services/decisionModel.service'
import {
  classifyReplyIntent,
  type ReplyChannel,
  type ReplyIntentDecide,
  type ReplyIntentLabel,
} from './replyIntent.util'

// How well classifyReplyIntent reads what a reply meant, on 43 invented
// replies. Every name, place and message here is fiction: omni is public.
//
// Each expected value is the person's INTENT, not the action the system
// takes on the reply. The production civic panel join check is keyword-only
// on purpose, because joining needs explicit consent, so a join by plain
// intent ("count me in for the panel") is a regex miss by design and not a
// compliance bug. The cases measure how well a reader gets intent, which is
// what a decision model would be asked to improve.
//
// One suite, two readers, picked by REPLY_INTENT_EVAL_MODE:
//  - `regex` (the default): today's predicates, no model call, free.
//  - `decision`: the decision model with the regex as the opt-out floor,
//    the path REPLY_INTENT_DECISION_SHADOW turns on in ingest. It needs the
//    provider's key (GEMINI_API_KEY by default) and never falls back to the
//    regex: no key fails the file, a rejected key fails every case.
//
// A case passes when all three attempts get every label right, so the
// passed count Vitest prints is the score out of 43 and the failed test
// names are the misses. Run it with
// `npm run eval -w packages/gp-api -- replyIntent.eval.ts`.

const EVAL_MODE_ENV = 'REPLY_INTENT_EVAL_MODE'

const mode = z
  .enum(['regex', 'decision'])
  .parse(process.env[EVAL_MODE_ENV]?.trim() || 'regex')

if (mode === 'decision') {
  const provider = decisionModelProvider()
  if (!decisionModelApiKey(provider)) {
    throw new Error(
      `${EVAL_MODE_ENV}=decision needs the ${provider} decision model key ` +
        'in the environment, and this suite never falls back to the regex.',
    )
  }
}

const decisionModels = new DecisionModelService()

type ReplyIntentCaseInput = { text: string; channel: ReplyChannel }

type ReplyIntentJudgment = Record<ReplyIntentLabel, boolean>

export default defineExpectedResultEvalSuite(`reply_intent_${mode}`, {
  run: async (input: ReplyIntentCaseInput, ctx) => {
    const decide: ReplyIntentDecide = async (request) => {
      const result = await decisionModels.decide(request)
      await ctx.annotate(
        `${result.provider} ${result.model}: ` +
          `${result.usage.inputTokens} input tokens, ` +
          `$${(result.costUsd ?? 0).toFixed(6)}`,
        'decision-model',
      )
      return result
    }
    return classifyReplyIntent(
      input.text,
      mode === 'decision' ? decide : null,
      input.channel,
    )
  },
  judge: async (intent): Promise<ReplyIntentJudgment> => ({
    optOut: intent.optOut.value,
    civicPanelJoin: intent.civicPanelJoin.value,
    civicPanelLeave: intent.civicPanelLeave.value,
  }),
  cases: [
    {
      id: 'stop_plain',
      input: { text: 'STOP', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'unsubscribe_plain',
      input: { text: 'UNSUBSCRIBE', channel: 'email' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'stop_please',
      input: { text: 'stop please', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'opt_me_out',
      input: { text: 'opt me out', channel: 'email' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'polite_remove_from_list',
      input: {
        text: 'Hi, please remove me from your mailing list. Thanks.',
        channel: 'email',
      },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'dont_text_me',
      input: { text: "Please don't text me again.", channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'complaint_then_stop',
      input: { text: 'Too many messages this week. STOP', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'take_me_off_call_list',
      input: { text: 'Can you take me off your call list', channel: 'call' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'lose_my_number',
      input: { text: 'lose my number', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    // An opt-out, not a panel leave: there is no panel in it.
    {
      id: 'wrong_person_leave_alone',
      input: { text: 'Wrong person. Leave me alone.', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'not_interested_stop_contacting',
      input: {
        text: 'I am not interested. Please stop contacting me.',
        channel: 'email',
      },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    // Feedback and an opt-out in one reply; the opt-out is the intent that matters for consent.
    {
      id: 'feedback_then_unsubscribe',
      input: {
        text: 'Fix the potholes on 5th Ave. And please unsubscribe me.',
        channel: 'email',
      },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    // Plainly asks for the texts to end without a listed phrase.
    {
      id: 'quit_blowing_up_phone',
      input: { text: 'pls quit blowing up my phone', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    // Spanish for "do not send me more messages".
    {
      id: 'spanish_no_more_messages',
      input: { text: 'No me manden más mensajes por favor', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    {
      id: 'done_hearing_from_you',
      input: {
        text: "Enough with the texts already, I'm done hearing from you",
        channel: 'text',
      },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    // A misspelling of a listed phrase.
    {
      id: 'typo_stop_txting',
      input: { text: 'stop txting me', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    // Asks for contact to end on the channel it arrived on.
    {
      id: 'door_no_more_visits',
      input: {
        text: "Please don't come back to my house again, I don't want any more visits",
        channel: 'door',
      },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
    },
    // Uses "stop" about a policy, not about the messages.
    {
      id: 'bait_stop_the_highway',
      input: {
        text: 'We need to stop the new highway before it splits the neighborhood.',
        channel: 'text',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'bait_dont_stop_fighting',
      input: { text: "Don't stop fighting for us!", channel: 'text' },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'bait_remove_stop_sign',
      input: {
        text: 'Can the city remove the stop sign on Alder Street? It causes backups.',
        channel: 'email',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'bait_noise_needs_to_stop',
      input: {
        text: 'The noise from the construction site needs to stop',
        channel: 'text',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'bait_end_of_sentence',
      input: { text: 'I support the budget. End.', channel: 'text' },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'bait_remove_dead_trees',
      input: {
        text: 'Please remove the dead trees in Willow Park before they fall.',
        channel: 'call',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'bait_quit_her_job',
      input: {
        text: 'My neighbor had to quit her job because the bus route was cut.',
        channel: 'call',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'join_keyword',
      input: { text: 'JOIN', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: true, civicPanelLeave: false },
    },
    {
      id: 'join_yes',
      input: { text: 'yes join', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: true, civicPanelLeave: false },
    },
    {
      id: 'join_after_sentence',
      input: { text: 'Sounds good. JOIN!', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: true, civicPanelLeave: false },
    },
    // Joining by intent with no keyword. The production check misses it on purpose; see the list note.
    {
      id: 'join_intent_count_me_in',
      input: { text: 'count me in for the panel', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: true, civicPanelLeave: false },
    },
    // Joining by intent with no keyword.
    {
      id: 'join_intent_sign_me_up',
      input: {
        text: "I'd love to be part of the community panel, sign me up.",
        channel: 'email',
      },
      expected: { optOut: false, civicPanelJoin: true, civicPanelLeave: false },
    },
    // About a meeting, not the panel.
    {
      id: 'bait_join_the_meeting',
      input: {
        text: "I'd like to join the meeting on Tuesday",
        channel: 'text',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'bait_join_us_market',
      input: {
        text: 'Join us at the farmers market Saturday!',
        channel: 'email',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'leave_keyword',
      input: { text: 'LEAVE', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: false, civicPanelLeave: true },
    },
    {
      id: 'leave_panel',
      input: { text: 'Leave panel', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: false, civicPanelLeave: true },
    },
    {
      id: 'leave_the_panel_please',
      input: { text: 'leave the panel please', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: false, civicPanelLeave: true },
    },
    // Leaves the panel and asks to keep getting texts, so it is not an opt-out.
    {
      id: 'leave_panel_keep_updates',
      input: {
        text: "I'm done with the panel surveys, take me off the panel but keep sending city updates",
        channel: 'text',
      },
      expected: { optOut: false, civicPanelJoin: false, civicPanelLeave: true },
    },
    {
      id: 'bait_left_meeting_early',
      input: {
        text: 'I had to leave the meeting early, what did I miss?',
        channel: 'call',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    // Leaves the panel and opts out of every text.
    {
      id: 'leave_and_stop',
      input: { text: 'LEAVE. Also, STOP.', channel: 'text' },
      expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: true },
    },
    {
      id: 'join_then_question',
      input: { text: 'JOIN. When is the next town hall?', channel: 'text' },
      expected: { optOut: false, civicPanelJoin: true, civicPanelLeave: false },
    },
    {
      id: 'ordinary_thanks',
      input: { text: 'Thanks for the update!', channel: 'text' },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'ordinary_win_support',
      input: {
        text: "Happy to see someone running who isn't tied to a party. You have my vote.",
        channel: 'door',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'ordinary_serve_question',
      input: {
        text: 'When does the council vote on the library hours?',
        channel: 'email',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'ordinary_school_parking',
      input: {
        text: 'Parking near the school is a mess at pickup time.',
        channel: 'call',
      },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
    {
      id: 'ordinary_who_is_this',
      input: { text: 'Who is this?', channel: 'text' },
      expected: {
        optOut: false,
        civicPanelJoin: false,
        civicPanelLeave: false,
      },
    },
  ],
})
