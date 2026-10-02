import { describe, it, expect } from 'vitest'
import {
  AudioUploadUrlRequestSchema,
  CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
  ConfirmConstituentFeedbackSchema,
  RecordConstituentFeedbackSchema,
} from './ConstituentFeedback.schema'

const KNOCK_KEY = '11111111-1111-4111-8111-111111111111'
const MEMO_KEY = '22222222-2222-4222-8222-222222222222'

const knockMemo = {
  channel: 'door_knock' as const,
  knockClientKey: KNOCK_KEY,
  stopTargetId: 21,
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

// The offline path: the phone recorded the memo with no signal and uploaded
// the audio later, so the server transcribes it and there is no text yet.
describe('RecordConstituentFeedbackSchema with a recording', () => {
  const AUDIO_KEY = `constituent-feedback/eo-town/${MEMO_KEY}.webm`
  const { transcript: _knockText, ...knockWithoutText } = knockMemo
  const { transcript: _callText, ...callWithoutText } = callMemo

  it('accepts a door-knock memo carrying its recording', () => {
    const memo = {
      ...knockWithoutText,
      audioKey: AUDIO_KEY,
      captureMethod: 'dictation_offline' as const,
    }
    expect(RecordConstituentFeedbackSchema.parse(memo)).toEqual(memo)
  })

  it('accepts a phone-bank memo carrying its recording', () => {
    const memo = {
      ...callWithoutText,
      audioKey: AUDIO_KEY,
      captureMethod: 'dictation_offline' as const,
    }
    expect(RecordConstituentFeedbackSchema.parse(memo)).toEqual(memo)
  })

  // Exactly one source of words: text the phone already has, or a recording
  // the server will turn into text. Both would leave the row two answers.
  it('refuses a memo with both a transcript and a recording', () => {
    expect(
      RecordConstituentFeedbackSchema.safeParse({
        ...knockMemo,
        audioKey: AUDIO_KEY,
        captureMethod: 'dictation_offline',
      }).success,
    ).toBe(false)
  })

  it('refuses a memo with neither', () => {
    expect(
      RecordConstituentFeedbackSchema.safeParse(knockWithoutText).success,
    ).toBe(false)
  })

  // The capture method is what tells a server-transcribed memo apart from
  // one dictated live, so the two must agree with what was sent.
  it('refuses a recording that does not say it was recorded offline', () => {
    expect(
      RecordConstituentFeedbackSchema.safeParse({
        ...callWithoutText,
        audioKey: AUDIO_KEY,
        captureMethod: 'dictation',
      }).success,
    ).toBe(false)
  })

  it('refuses an offline capture method on a memo that has its text', () => {
    expect(
      RecordConstituentFeedbackSchema.safeParse({
        ...callMemo,
        captureMethod: 'dictation_offline',
      }).success,
    ).toBe(false)
  })
})

describe('AudioUploadUrlRequestSchema', () => {
  // The key is built from this value, so anything but a uuid could reach
  // outside the org's prefix.
  it('refuses a client key that is not a uuid', () => {
    expect(
      AudioUploadUrlRequestSchema.safeParse({
        clientKey: '../other-org/x',
        contentType: 'audio/webm',
      }).success,
    ).toBe(false)
  })

  it('accepts a uuid client key and either container', () => {
    for (const contentType of ['audio/webm;codecs=opus', 'audio/mp4']) {
      expect(
        AudioUploadUrlRequestSchema.parse({ clientKey: MEMO_KEY, contentType }),
      ).toEqual({ clientKey: MEMO_KEY, contentType })
    }
  })

  // The policy pins this type, so it has to be audio.
  it('refuses a type that is not audio', () => {
    expect(
      AudioUploadUrlRequestSchema.safeParse({
        clientKey: MEMO_KEY,
        contentType: 'text/html',
      }).success,
    ).toBe(false)
  })
})

describe('ConfirmConstituentFeedbackSchema', () => {
  // A confirmation states every field of every issue, including the ones
  // deliberately left empty — that is what distinguishes "the canvasser says
  // there was no stance" from "nobody has looked at this yet".
  it('accepts issues with fields left null on purpose', () => {
    const confirmed = {
      issues: [
        {
          issueLabel: 'Flock cameras',
          stance: 'opposes' as const,
          desiredOutcome: null,
          fromIssueId: '0192f1c4-0000-7000-8000-000000000001',
        },
        {
          issueLabel: 'Street flooding',
          stance: null,
          desiredOutcome: 'Clear the storm drain',
        },
      ],
    }
    expect(ConfirmConstituentFeedbackSchema.parse(confirmed)).toEqual(confirmed)
  })

  // The list replaces the memo's issues, so an empty one is how a canvasser
  // says the conversation named none.
  it('accepts an empty list', () => {
    expect(ConfirmConstituentFeedbackSchema.parse({ issues: [] })).toEqual({
      issues: [],
    })
  })

  it('refuses more than five issues', () => {
    const issue = {
      issueLabel: 'Flock cameras',
      stance: 'opposes',
      desiredOutcome: null,
    }
    expect(
      ConfirmConstituentFeedbackSchema.safeParse({
        issues: Array.from({ length: 6 }, () => issue),
      }).success,
    ).toBe(false)
  })

  // An issue is the thing they talked about; one with no name is not one.
  it('refuses an issue with no label', () => {
    expect(
      ConfirmConstituentFeedbackSchema.safeParse({
        issues: [{ issueLabel: '  ', stance: 'opposes', desiredOutcome: null }],
      }).success,
    ).toBe(false)
  })

  it('refuses a stance outside the Serve vocabulary', () => {
    expect(
      ConfirmConstituentFeedbackSchema.safeParse({
        issues: [
          {
            issueLabel: 'Flock cameras',
            stance: 'supporter',
            desiredOutcome: null,
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('refuses unknown fields so a stale client cannot half-write an issue', () => {
    expect(
      ConfirmConstituentFeedbackSchema.safeParse({
        issues: [
          {
            issueLabel: 'Flock cameras',
            stance: 'opposes',
            desiredOutcome: null,
            reason: 'privacy',
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      ConfirmConstituentFeedbackSchema.safeParse({
        issueLabel: 'Flock cameras',
        stance: 'opposes',
        desiredOutcome: null,
      }).success,
    ).toBe(false)
  })
})
