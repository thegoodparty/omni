import { describe, expect, it } from 'vitest'
import {
  DOOR_KNOCKING_PURPOSES,
  DOOR_KNOCKING_PURPOSE_LABELS,
  DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS,
  doorKnockingPurposeLabel,
  doorKnockingPurposeNameSuggestion,
} from './doorKnockingPurposes'

// Locks the cards to the design canvas's DOOR_PURPOSES, in order. Robocall and
// phone banking both shipped with social's labels copy-pasted and had to be
// corrected in #1379; door knocking's goals are about a conversation on a
// doorstep and have no equivalent on a channel that sends a message.
describe('DOOR_KNOCKING_PURPOSES', () => {
  it('matches the canvas cards, in order', () => {
    expect(DOOR_KNOCKING_PURPOSES.map((purpose) => purpose.id)).toEqual([
      'issue',
      'introduce',
      'persuade',
      'turnout',
      'event',
      'custom',
    ])
    expect(DOOR_KNOCKING_PURPOSE_LABELS).toEqual({
      issue: 'Discover local issues',
      introduce: 'Introduce myself',
      persuade: 'Persuade undecided voters',
      turnout: 'Turn out my supporters',
      event: 'Invite people to an event',
      custom: 'Something else',
    })
  })

  it('gives every card a second line', () => {
    for (const purpose of DOOR_KNOCKING_PURPOSES) {
      expect(purpose.description.length).toBeGreaterThan(0)
    }
  })

  it('falls back for a slug it does not know', () => {
    expect(doorKnockingPurposeLabel('turnout')).toBe('Turn out my supporters')
    expect(doorKnockingPurposeLabel('not-a-purpose')).toBe('Door knocking list')
  })
})

describe('DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short list name, not the card copy', () => {
    expect(doorKnockingPurposeNameSuggestion('turnout')).toBe('Turnout walk')
    expect(doorKnockingPurposeNameSuggestion('issue')).toBe('Listening walk')
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
