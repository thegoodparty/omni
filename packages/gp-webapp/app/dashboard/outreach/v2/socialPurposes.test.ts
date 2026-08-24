import { describe, expect, it } from 'vitest'
import {
  SOCIAL_PURPOSE_LABELS,
  SOCIAL_PURPOSE_NAME_SUGGESTIONS,
  socialPurposeLabel,
  socialPurposeNameSuggestion,
} from './socialPurposes'

describe('socialPurposeLabel', () => {
  it('falls back for a slug it does not know', () => {
    expect(socialPurposeLabel('introduce_myself')).toBe('Introduce myself')
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
