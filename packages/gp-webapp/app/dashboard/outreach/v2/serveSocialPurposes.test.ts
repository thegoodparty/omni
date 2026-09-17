import { describe, expect, it } from 'vitest'
import {
  SERVE_SOCIAL_PURPOSE_LABELS,
  SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS,
  serveSocialPurposeLabel,
  serveSocialPurposeNameSuggestion,
} from './serveSocialPurposes'

describe('serveSocialPurposeLabel', () => {
  it('falls back for a slug it does not know', () => {
    expect(serveSocialPurposeLabel('introduce_myself')).toBe('Introduce myself')
    expect(serveSocialPurposeLabel('not-a-purpose')).toBe('Social post')
  })
})

describe('SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short campaign name, not the card copy', () => {
    expect(serveSocialPurposeNameSuggestion('explain_decision')).toBe(
      'Decision update posts',
    )
    expect(serveSocialPurposeNameSuggestion('introduce_myself')).toBe(
      'Introduction posts',
    )
    expect(serveSocialPurposeNameSuggestion('not-a-purpose')).toBe(
      'Social post',
    )
  })

  // The bug this file guards against: a card-copy correction reaching the
  // outreach history through a shared record.
  it('shares no wording with the card labels', () => {
    for (const purpose of Object.keys(
      SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS,
    ) as (keyof typeof SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS)[]) {
      expect(SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS[purpose]).not.toBe(
        SERVE_SOCIAL_PURPOSE_LABELS[purpose],
      )
    }
  })
})
