import { describe, expect, it } from 'vitest'
import { SERVE_OUTREACH_PURPOSE_VALUES } from '@goodparty_org/contracts'
import {
  SERVE_DOOR_KNOCKING_PURPOSES,
  SERVE_DOOR_KNOCKING_PURPOSE_LABELS,
  SERVE_DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS,
  SERVE_DOOR_KNOCKING_PURPOSE_VALUES,
  serveDoorKnockingPurposeLabel,
  serveDoorKnockingPurposeNameSuggestion,
} from './serveDoorKnockingPurposes'

// Serve's own goal cards for the same one door-knocking route — door
// knocking's wording, not phone banking's, on the shared Serve vocabulary.
describe('SERVE_DOOR_KNOCKING_PURPOSES', () => {
  it('is the shared serve outreach vocabulary, in order', () => {
    expect(SERVE_DOOR_KNOCKING_PURPOSE_VALUES).toEqual(
      SERVE_OUTREACH_PURPOSE_VALUES,
    )
    expect(SERVE_DOOR_KNOCKING_PURPOSES).toEqual([
      { id: 'introduce_myself', label: 'Introduce myself' },
      { id: 'explain_decision', label: 'Explain a recent decision' },
      { id: 'event_invite', label: 'Invite people to an event' },
      { id: 'community_input', label: 'Ask for community input' },
      { id: 'share_resource', label: 'Share a resource or service' },
      { id: 'custom', label: 'Something else' },
    ])
  })

  it('gives every slug a label and a name suggestion', () => {
    for (const value of SERVE_DOOR_KNOCKING_PURPOSE_VALUES) {
      expect(SERVE_DOOR_KNOCKING_PURPOSE_LABELS[value].length).toBeGreaterThan(
        0,
      )
      expect(
        SERVE_DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS[value].length,
      ).toBeGreaterThan(0)
    }
  })

  it('falls back for a slug it does not know', () => {
    expect(serveDoorKnockingPurposeLabel('explain_decision')).toBe(
      'Explain a recent decision',
    )
    expect(serveDoorKnockingPurposeLabel('not-a-purpose')).toBe(
      'Door knocking list',
    )
  })
})

describe('SERVE_DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short list name, not the card copy', () => {
    expect(serveDoorKnockingPurposeNameSuggestion('explain_decision')).toBe(
      'Decision update walk',
    )
    expect(serveDoorKnockingPurposeNameSuggestion('community_input')).toBe(
      'Community input walk',
    )
    expect(serveDoorKnockingPurposeNameSuggestion('not-a-purpose')).toBe(
      'Door knocking list',
    )
  })

  // The bug this file guards against (#1385): a card-copy correction
  // reaching saved list names through a shared record.
  it('shares no wording with the card labels', () => {
    for (const purpose of SERVE_DOOR_KNOCKING_PURPOSES) {
      expect(SERVE_DOOR_KNOCKING_PURPOSE_NAME_SUGGESTIONS[purpose.id]).not.toBe(
        SERVE_DOOR_KNOCKING_PURPOSE_LABELS[purpose.id],
      )
    }
  })
})
