import { describe, expect, it } from 'vitest'
import {
  SOCIAL_PURPOSES,
  SOCIAL_PURPOSE_LABELS,
  SOCIAL_PURPOSE_NAME_SUGGESTIONS,
  socialPurposeLabel,
  socialPurposeNameSuggestion,
} from './socialPurposes'
import { SMS_PURPOSES } from './sms/smsCompose.util'

// "Hear from voters" asks a question, and a post or a text has nobody there
// to hear the answer. SMS borrows these labels, so it is checked here too.
describe('the purpose that asks a question', () => {
  it('is not offered on social', () => {
    expect(SOCIAL_PURPOSES.map((p) => p.id)).not.toContain('community_input')
    expect(SOCIAL_PURPOSES.map((p) => p.label)).not.toContain(
      'Hear from voters',
    )
  })

  it('is not offered on SMS', () => {
    expect(SMS_PURPOSES.map((p) => p.id)).not.toContain('community_input')
  })
})

describe('socialPurposeLabel', () => {
  it('falls back for a slug it does not know', () => {
    expect(socialPurposeLabel('introduce_myself')).toBe(
      'Introduce myself to voters',
    )
    expect(socialPurposeLabel('not-a-purpose')).toBe('Social post')
  })
})

describe('SOCIAL_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short campaign name, not the card copy', () => {
    expect(socialPurposeNameSuggestion('election_day_turnout')).toBe(
      'Election day posts',
    )
    expect(socialPurposeNameSuggestion('introduce_myself')).toBe(
      'Introduction posts',
    )
    expect(socialPurposeNameSuggestion('not-a-purpose')).toBe('Social post')
  })

  // The bug this file guards against: a card-copy correction reaching the
  // outreach history through a shared record.
  it('shares no wording with the card labels', () => {
    for (const purpose of Object.keys(
      SOCIAL_PURPOSE_NAME_SUGGESTIONS,
    ) as (keyof typeof SOCIAL_PURPOSE_NAME_SUGGESTIONS)[]) {
      expect(SOCIAL_PURPOSE_NAME_SUGGESTIONS[purpose]).not.toBe(
        SOCIAL_PURPOSE_LABELS[purpose],
      )
    }
  })
})
