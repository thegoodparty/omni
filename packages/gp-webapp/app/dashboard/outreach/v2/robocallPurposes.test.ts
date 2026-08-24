import { describe, expect, it } from 'vitest'
import { ROBOCALL_PURPOSES } from './robocallPurposes'
import { SOCIAL_PURPOSES } from './socialPurposes'

// Locks the cards to the design canvas's ROBOCALL_PURPOSES, in order. These
// were previously copy-pasted from social, which uses shorter copy and carries
// a seventh "Share an issue update" card that robocall's canvas list does not
// have — so the drift is only visible by asserting the exact set.
describe('ROBOCALL_PURPOSES', () => {
  it('matches the canvas cards, in order', () => {
    expect(ROBOCALL_PURPOSES).toEqual([
      { id: 'introduce_myself', label: 'Introduce myself to voters' },
      { id: 'persuade_voters', label: 'Persuade likely voters' },
      { id: 'event_invite', label: 'Invite voters to a local event' },
      { id: 'early_voting', label: 'Encourage voters to vote early' },
      {
        id: 'election_day_turnout',
        label: 'Encourage voters to vote on election day',
      },
      { id: 'custom', label: 'Write my own script' },
    ])
  })

  it('has no issue-update card — that one belongs to social only', () => {
    expect(ROBOCALL_PURPOSES.map((p) => p.label)).not.toContain(
      'Share an issue update',
    )
    expect(SOCIAL_PURPOSES.map((p) => p.label)).toContain(
      'Share an issue update',
    )
  })
})
