import { describe, expect, it } from 'vitest'
import { SERVE_OUTREACH_PURPOSE_VALUES } from '@goodparty_org/contracts'
import {
  SERVE_SMS_PURPOSE_LABELS,
  SERVE_SMS_PURPOSE_NAME_SUGGESTIONS,
  SERVE_SMS_PURPOSES,
  serveSmsPurposeLabel,
  serveSmsPurposeNameSuggestion,
} from './serveSmsPurposes'

describe('SERVE_SMS_PURPOSES', () => {
  it('renders the shared serve purpose vocabulary, in contract order', () => {
    expect(SERVE_SMS_PURPOSES.map((p) => p.id)).toEqual([
      ...SERVE_OUTREACH_PURPOSE_VALUES,
    ])
    expect(SERVE_SMS_PURPOSES).toEqual([
      { id: 'introduce_myself', label: 'Introduce myself to constituents' },
      { id: 'explain_decision', label: 'Explain a recent decision' },
      { id: 'event_invite', label: 'Invite constituents to a local event' },
      { id: 'community_input', label: 'Ask for community input' },
      { id: 'share_resource', label: 'Share a resource or service' },
      { id: 'custom', label: 'Write my own message' },
    ])
  })

  it('falls back for a slug it does not know', () => {
    expect(serveSmsPurposeLabel('explain_decision')).toBe(
      'Explain a recent decision',
    )
    expect(serveSmsPurposeLabel('persuade_voters')).toBe('Text campaign')
  })
})

describe('SERVE_SMS_PURPOSE_NAME_SUGGESTIONS', () => {
  it('suggests a short campaign name, not the card copy', () => {
    expect(serveSmsPurposeNameSuggestion('explain_decision')).toBe(
      'Decision update texts',
    )
    expect(serveSmsPurposeNameSuggestion('introduce_myself')).toBe(
      'Introduction texts',
    )
    expect(serveSmsPurposeNameSuggestion('persuade_voters')).toBe(
      'Text campaign',
    )
  })

  // The bug this file guards against: a card-copy correction reaching the
  // outreach history through a shared record.
  it('shares no wording with the card labels', () => {
    for (const purpose of SERVE_OUTREACH_PURPOSE_VALUES) {
      expect(SERVE_SMS_PURPOSE_NAME_SUGGESTIONS[purpose]).not.toBe(
        SERVE_SMS_PURPOSE_LABELS[purpose],
      )
    }
  })
})
