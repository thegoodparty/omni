import { describe, it, expect } from 'vitest'
import {
  CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
  ConfirmConstituentFeedbackSchema,
  RecordConstituentFeedbackSchema,
} from './ConstituentFeedback.schema'

const KNOCK_KEY = '11111111-1111-4111-8111-111111111111'
const MEMO_KEY = '22222222-2222-4222-8222-222222222222'

const knockMemo = {
  channel: 'door_knock' as const,
  knockClientKey: KNOCK_KEY,
  clientKey: MEMO_KEY,
  transcript: 'Talked to Bob. Against the Flock cameras, wants them removed.',
  captureMethod: 'dictation' as const,
}

const callMemo = {
  channel: 'phone_bank' as const,
  entryId: 42,
  personId: 'person-1',
  clientKey: MEMO_KEY,
  transcript: 'She is for the compost pilot but wants a smaller bin.',
  captureMethod: 'dictation' as const,
}

describe('RecordConstituentFeedbackSchema', () => {
  it('accepts a door-knock memo keyed on the knock it belongs to', () => {
    expect(RecordConstituentFeedbackSchema.parse(knockMemo)).toEqual(knockMemo)
  })

  it('accepts a phone-bank memo keyed on the entry and who picked up', () => {
    expect(RecordConstituentFeedbackSchema.parse(callMemo)).toEqual(callMemo)
  })

  // The whole reason for the discriminated union: a memo cannot carry one
  // channel's reference while claiming the other's channel, so no reader has
  // to defend against a row whose channel and interaction link disagree.
  it('refuses a knock reference on the phone-bank arm', () => {
    const result = RecordConstituentFeedbackSchema.safeParse({
      ...callMemo,
      knockClientKey: KNOCK_KEY,
    })
    expect(result.success).toBe(false)
  })

  it('refuses an entry reference on the door-knock arm', () => {
    const result = RecordConstituentFeedbackSchema.safeParse({
      ...knockMemo,
      entryId: 42,
    })
    expect(result.success).toBe(false)
  })

  it('refuses a knock memo with no knock to attach to', () => {
    const { knockClientKey: _omitted, ...withoutKnock } = knockMemo
    expect(
      RecordConstituentFeedbackSchema.safeParse(withoutKnock).success,
    ).toBe(false)
  })

  // An empty transcript is a memo that was never recorded. The surface saves
  // the knock without one rather than posting a blank row.
  it('refuses an empty transcript', () => {
    expect(
      RecordConstituentFeedbackSchema.safeParse({
        ...knockMemo,
        transcript: '',
      }).success,
    ).toBe(false)
  })

  it('refuses a transcript past the cap', () => {
    expect(
      RecordConstituentFeedbackSchema.safeParse({
        ...knockMemo,
        transcript: 'x'.repeat(CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false)
  })
})

describe('ConfirmConstituentFeedbackSchema', () => {
  // A confirmation states all three fields, including the ones deliberately
  // left empty — that is what distinguishes "the canvasser says there was no
  // stance" from "nobody has looked at this yet".
  it('accepts a triple with fields left null on purpose', () => {
    const confirmed = {
      issueLabel: 'Flock cameras',
      stance: 'opposes' as const,
      desiredOutcome: null,
    }
    expect(ConfirmConstituentFeedbackSchema.parse(confirmed)).toEqual(confirmed)
  })

  it('refuses a stance outside the Serve vocabulary', () => {
    expect(
      ConfirmConstituentFeedbackSchema.safeParse({
        issueLabel: 'Flock cameras',
        stance: 'supporter',
        desiredOutcome: null,
      }).success,
    ).toBe(false)
  })

  it('refuses unknown fields so a stale client cannot half-write a triple', () => {
    expect(
      ConfirmConstituentFeedbackSchema.safeParse({
        issueLabel: 'Flock cameras',
        stance: 'opposes',
        desiredOutcome: null,
        reason: 'privacy',
      }).success,
    ).toBe(false)
  })
})
