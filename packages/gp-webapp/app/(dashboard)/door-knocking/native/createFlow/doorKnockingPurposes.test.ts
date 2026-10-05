import { describe, expect, it } from 'vitest'
import { OUTREACH_PURPOSE_VALUES } from '@goodparty_org/contracts'
import {
  DOOR_KNOCKING_PURPOSES,
  DOOR_KNOCKING_PURPOSE_LABELS,
  DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS,
  DOOR_KNOCKING_PURPOSE_VALUES,
  doorKnockingPurposeLabel,
  doorKnockingPurposeNameSuggestion,
} from './doorKnockingPurposes'

// Door knocking adopted the shared outreach purpose vocabulary (Task 0/9) so
// its recommendations key on the same intents as SMS, robocall and phone
// banking — see docs/features/recommended-lists.md.
describe('DOOR_KNOCKING_PURPOSES', () => {
  it('is the shared outreach purpose vocabulary, in order', () => {
    expect(DOOR_KNOCKING_PURPOSE_VALUES).toEqual(OUTREACH_PURPOSE_VALUES)
    expect(DOOR_KNOCKING_PURPOSES.map((purpose) => purpose.id)).toEqual([
      'introduce_myself',
      'persuade_voters',
      'event_invite',
      'early_voting',
      'election_day_turnout',
      'custom',
    ])
    expect(DOOR_KNOCKING_PURPOSE_LABELS).toEqual({
      introduce_myself: 'Introduce myself',
      persuade_voters: 'Persuade undecided voters',
      event_invite: 'Invite people to an event',
      early_voting: 'Encourage early voting',
      election_day_turnout: 'Turn out my supporters',
      custom: 'Something else',
    })
  })

  it('falls back for a slug it does not know', () => {
    expect(doorKnockingPurposeLabel('election_day_turnout')).toBe(
      'Turn out my supporters',
    )
    expect(doorKnockingPurposeLabel('not-a-purpose')).toBe('Door knocking list')
  })
})

describe('DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short list name, not the card copy', () => {
    expect(doorKnockingPurposeNameSuggestion('election_day_turnout')).toBe(
      'Turnout walk',
    )
    expect(doorKnockingPurposeNameSuggestion('early_voting')).toBe(
      'Early voting walk',
    )
    expect(doorKnockingPurposeNameSuggestion('not-a-purpose')).toBe(
      'Door knocking list',
    )
  })

  // The bug this file guards against (#1385): a card-copy correction reaching
  // saved list names through a shared record.
  it('shares no wording with the card labels', () => {
    for (const purpose of DOOR_KNOCKING_PURPOSES) {
      expect(DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS[purpose.id]).not.toBe(
        DOOR_KNOCKING_PURPOSE_LABELS[purpose.id],
      )
    }
  })
})
