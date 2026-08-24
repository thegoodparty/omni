import { describe, expect, it } from 'vitest'
import {
  PHONE_BANKING_PURPOSE_LABELS,
  PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS,
  PHONE_BANKING_PURPOSES,
  phoneBankingPurposeLabel,
  phoneBankingPurposeNameSuggestion,
} from './phoneBankingPurposes'

// Locks the cards to the design canvas's PHONEBANK_PURPOSES, in order. The
// labels were previously copy-pasted from social's shorter copy, which reads
// wrong on a channel where a volunteer is speaking to a voter.
describe('PHONE_BANKING_PURPOSES', () => {
  it('matches the canvas cards, in order', () => {
    expect(PHONE_BANKING_PURPOSES).toEqual([
      { id: 'introduce', label: 'Introduce myself to voters' },
      { id: 'persuade', label: 'Persuade likely voters' },
      { id: 'event', label: 'Invite voters to a local event' },
      { id: 'vote-early', label: 'Encourage voters to vote early' },
      {
        id: 'election-day',
        label: 'Encourage voters to vote on election day',
      },
      { id: 'custom', label: 'Write my own script' },
    ])
  })

  it('falls back for a slug it does not know', () => {
    expect(phoneBankingPurposeLabel('introduce')).toBe(
      'Introduce myself to voters',
    )
    expect(phoneBankingPurposeLabel('not-a-purpose')).toBe(
      'Phone banking calls',
    )
  })
})

describe('PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short campaign name, not the card copy', () => {
    expect(phoneBankingPurposeNameSuggestion('election-day')).toBe(
      'Election day calls',
    )
    expect(phoneBankingPurposeNameSuggestion('introduce')).toBe(
      'Introduction calls',
    )
    expect(phoneBankingPurposeNameSuggestion('not-a-purpose')).toBe(
      'Phone banking calls',
    )
  })

  // The bug this file guards against: a card-copy correction reaching the
  // outreach history through a shared record.
  it('shares no wording with the card labels', () => {
    for (const purpose of Object.keys(
      PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS,
    ) as (keyof typeof PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS)[]) {
      expect(PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS[purpose]).not.toBe(
        PHONE_BANKING_PURPOSE_LABELS[purpose],
      )
    }
  })
})
