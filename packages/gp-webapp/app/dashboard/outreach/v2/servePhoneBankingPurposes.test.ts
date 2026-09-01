import { describe, expect, it } from 'vitest'
import {
  SERVE_PHONE_BANKING_PURPOSE_LABELS,
  SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS,
  SERVE_PHONE_BANKING_PURPOSES,
  servePhoneBankingPurposeLabel,
  servePhoneBankingPurposeNameSuggestion,
} from './servePhoneBankingPurposes'

// Locks the cards to the design canvas's serve PHONEBANK_PURPOSES, in order.
describe('SERVE_PHONE_BANKING_PURPOSES', () => {
  it('matches the canvas cards, in order', () => {
    expect(SERVE_PHONE_BANKING_PURPOSES).toEqual([
      { id: 'introduce', label: 'Introduce myself to constituents' },
      { id: 'explain-decision', label: 'Explain a recent decision' },
      { id: 'event', label: 'Invite constituents to a local event' },
      { id: 'community-input', label: 'Ask for community input' },
      { id: 'share-resource', label: 'Share a resource or service' },
      { id: 'custom', label: 'Write my own script' },
    ])
  })

  it('falls back for a slug it does not know', () => {
    expect(servePhoneBankingPurposeLabel('introduce')).toBe(
      'Introduce myself to constituents',
    )
    expect(servePhoneBankingPurposeLabel('not-a-purpose')).toBe(
      'Phone banking calls',
    )
  })
})

describe('SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short campaign name, not the card copy', () => {
    expect(servePhoneBankingPurposeNameSuggestion('explain-decision')).toBe(
      'Decision update calls',
    )
    expect(servePhoneBankingPurposeNameSuggestion('introduce')).toBe(
      'Introduction calls',
    )
    expect(servePhoneBankingPurposeNameSuggestion('not-a-purpose')).toBe(
      'Phone banking calls',
    )
  })

  // The bug this file guards against: a card-copy correction reaching the
  // outreach history through a shared record.
  it('shares no wording with the card labels', () => {
    for (const purpose of Object.keys(
      SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS,
    ) as (keyof typeof SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS)[]) {
      expect(SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS[purpose]).not.toBe(
        SERVE_PHONE_BANKING_PURPOSE_LABELS[purpose],
      )
    }
  })
})
