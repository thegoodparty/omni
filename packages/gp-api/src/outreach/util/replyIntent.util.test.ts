import { describe, expect, it, type Mock, vi } from 'vitest'
import type { YesNoAnswer } from '@/decisionModels/schemas/decisionQuestions.schema'
import { isCivicPanelJoinMessage } from './civicPanelJoin.util'
import { isCivicPanelLeaveMessage } from './civicPanelLeave.util'
import {
  classifyReplyIntent,
  OPT_OUT_FLOOR_PROBABILITY,
  REPLY_INTENT_LABELS,
  REPLY_INTENT_YES_THRESHOLD,
  type ReplyChannel,
  type ReplyIntentDecide,
  type ReplyIntentLabel,
} from './replyIntent.util'
import { isOptOutMessage } from './textOptOut.util'

const yes = (pTrue: number): YesNoAnswer => ({
  type: 'yesNo',
  value: pTrue >= 0.5,
  probabilities: { true: pTrue, false: 1 - pTrue },
})

const fakeDecide = (
  pTrue: Record<ReplyIntentLabel, number>,
): Mock<ReplyIntentDecide> =>
  vi.fn<ReplyIntentDecide>().mockResolvedValue({
    answers: {
      optOut: yes(pTrue.optOut),
      civicPanelJoin: yes(pTrue.civicPanelJoin),
      civicPanelLeave: yes(pTrue.civicPanelLeave),
    },
  })

const ALL_LOW = { optOut: 0.02, civicPanelJoin: 0.01, civicPanelLeave: 0.03 }

describe('classifyReplyIntent without a decision client', () => {
  it.each([
    'STOP',
    'JOIN',
    'leave please',
    'The noise from the site needs to stop',
    'I had to leave the meeting early',
    'Thanks for the update on the park',
    '',
  ])('matches the three regex predicates for %j', async (text) => {
    expect(await classifyReplyIntent(text, null)).toEqual({
      optOut: { value: isOptOutMessage(text) },
      civicPanelJoin: { value: isCivicPanelJoinMessage(text) },
      civicPanelLeave: { value: isCivicPanelLeaveMessage(text) },
    })
  })
})

describe('classifyReplyIntent with a decision client', () => {
  it('asks one yes/no question per label about the reply', async () => {
    const decide = fakeDecide(ALL_LOW)

    await classifyReplyIntent('Please take me off this list', decide)

    expect(decide).toHaveBeenCalledTimes(1)
    const [request] = decide.mock.calls[0] ?? []
    if (!request) throw new Error('expected one decide call')
    expect(request.input).toBe('Please take me off this list')
    expect(Object.keys(request.questions).sort()).toEqual(
      [...REPLY_INTENT_LABELS].sort(),
    )
    for (const question of Object.values(request.questions)) {
      expect(question.type).toBe('yesNo')
    }
  })

  it("uses the model's probabilities and the named threshold per label", async () => {
    const result = await classifyReplyIntent(
      'Count me in for the group',
      fakeDecide({
        optOut: 0.1,
        civicPanelJoin: REPLY_INTENT_YES_THRESHOLD,
        civicPanelLeave: REPLY_INTENT_YES_THRESHOLD - 0.01,
      }),
    )

    expect(result).toEqual({
      optOut: { value: false, probabilities: { true: 0.1, false: 0.9 } },
      civicPanelJoin: {
        value: true,
        probabilities: {
          true: REPLY_INTENT_YES_THRESHOLD,
          false: 1 - REPLY_INTENT_YES_THRESHOLD,
        },
      },
      civicPanelLeave: {
        value: false,
        probabilities: {
          true: REPLY_INTENT_YES_THRESHOLD - 0.01,
          false: 1 - (REPLY_INTENT_YES_THRESHOLD - 0.01),
        },
      },
    })
  })

  it('keeps a regex opt-out true when the model disagrees, at the floor', async () => {
    const result = await classifyReplyIntent('STOP', fakeDecide(ALL_LOW))

    expect(result.optOut).toEqual({
      value: true,
      probabilities: {
        true: OPT_OUT_FLOOR_PROBABILITY,
        false: 1 - OPT_OUT_FLOOR_PROBABILITY,
      },
    })
  })

  it("keeps the model's opt-out probability when it is above the floor", async () => {
    const result = await classifyReplyIntent(
      'STOP',
      fakeDecide({ ...ALL_LOW, optOut: 0.999 }),
    )

    expect(result.optOut.probabilities?.true).toBe(0.999)
  })

  it('lets the model find an opt-out the regex misses', async () => {
    const text = 'Please quit sending these to my phone'
    expect(isOptOutMessage(text)).toBe(false)

    const result = await classifyReplyIntent(
      text,
      fakeDecide({ ...ALL_LOW, optOut: 0.93 }),
    )

    expect(result.optOut.value).toBe(true)
  })

  it('lets the model overrule a regex join or leave', async () => {
    const result = await classifyReplyIntent('JOIN', fakeDecide(ALL_LOW))

    expect(result.civicPanelJoin.value).toBe(false)
  })

  it('never sends an empty reply to the model', async () => {
    const decide = fakeDecide(ALL_LOW)

    const result = await classifyReplyIntent('   ', decide)

    expect(decide).not.toHaveBeenCalled()
    expect(result.optOut).toEqual({ value: false })
  })
})

describe('classifyReplyIntent by channel', () => {
  const CHANNELS: ReplyChannel[] = ['text', 'email', 'door', 'call']

  const questionsAsked = async (channel?: ReplyChannel) => {
    const decide = fakeDecide(ALL_LOW)
    await classifyReplyIntent('Not interested right now', decide, channel)
    const [request] = decide.mock.calls[0] ?? []
    if (!request) throw new Error('expected one decide call')
    return request.questions
  }

  it('reads a reply as a text when no channel is given', async () => {
    expect(await questionsAsked()).toEqual(await questionsAsked('text'))
  })

  it('words the questions differently for each channel, same labels', async () => {
    const asked = await Promise.all(CHANNELS.map(questionsAsked))
    const optOutInstructions = new Set(
      asked.map((questions) => questions.optOut.instructions),
    )
    expect(optOutInstructions.size).toBe(CHANNELS.length)
    for (const questions of asked) {
      expect(Object.keys(questions).sort()).toEqual(
        [...REPLY_INTENT_LABELS].sort(),
      )
    }
  })

  it.each(CHANNELS)('is the regex on %s with no client', async (channel) => {
    expect(await classifyReplyIntent('STOP', null, channel)).toEqual({
      optOut: { value: true },
      civicPanelJoin: { value: false },
      civicPanelLeave: { value: false },
    })
  })

  it.each(CHANNELS)('keeps the opt-out floor on %s', async (channel) => {
    const result = await classifyReplyIntent(
      'STOP',
      fakeDecide(ALL_LOW),
      channel,
    )
    expect(result.optOut.value).toBe(true)
  })
})
