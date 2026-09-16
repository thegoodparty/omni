import { describe, expect, it } from 'vitest'
import { EMPTY_TURF_MESSAGE, emptyAudienceMessage } from './emptyAudience.util'
import type { ContactsFilterResolutionInput } from '@/contacts/services/contacts.service'

const filter = (
  overrides: Partial<ContactsFilterResolutionInput> = {},
): ContactsFilterResolutionInput => overrides as ContactsFilterResolutionInput

describe('emptyAudienceMessage', () => {
  it('names the criterion a list was cut by', () => {
    expect(emptyAudienceMessage(filter({ supportStatus: ['supporter'] }))).toBe(
      "No voters match this list's support status filters — edit the list or pick a different audience",
    )
  })

  it('reads prior outreach off the relation, not off a column', () => {
    // activityConditions arrives as loaded relation rows. A create that
    // forgot to `include` them would resolve as if the list had none, so the
    // message has to come from the same place the resolution does.
    const message = emptyAudienceMessage(
      filter({
        activityConditions: [
          { outreachType: 'text', outreachId: 1, actions: ['responded'] },
        ] as ContactsFilterResolutionInput['activityConditions'],
      }),
    )
    expect(message).toContain('previous outreach')
  })

  it('reads contacts made off any of its six bucket columns', () => {
    expect(emptyAudienceMessage(filter({ contactsMade5Plus: true }))).toContain(
      'contacts made',
    )
    expect(emptyAudienceMessage(filter({ contactsMade0: true }))).toContain(
      'contacts made',
    )
  })

  it('lists every criterion in play, since the empty set is their intersection', () => {
    // Which one was decisive is not knowable — the resolution intersects and
    // reports one 'empty' — so all three are named rather than guessing.
    const message = emptyAudienceMessage(
      filter({
        supportStatus: ['supporter'],
        contactsMade0: true,
        activityConditions: [
          { outreachType: 'text', outreachId: 1, actions: ['responded'] },
        ] as ContactsFilterResolutionInput['activityConditions'],
      }),
    )
    expect(message).toContain(
      'support status, previous outreach and contacts made',
    )
  })

  it('falls back to the plain noun when no emptiable criterion is set', () => {
    // Should not be reachable: a list carrying none of the three resolves to
    // a column predicate, and no rows back is the polygon case. Worth a
    // sentence rather than an empty one if it ever is.
    expect(emptyAudienceMessage(filter({ partyDemocrat: true }))).toBe(
      "No voters match this list's filters — edit the list or pick a different audience",
    )
  })

  it('never tells the candidate to redraw a boundary it has not looked at', () => {
    // The regression QA reported. This message is raised before the polygon
    // is read, so the area cannot be the advice.
    for (const input of [
      filter({ supportStatus: ['supporter'] }),
      filter({ contactsMade0: true }),
      filter({}),
    ]) {
      expect(emptyAudienceMessage(input)).not.toContain('turf')
      expect(emptyAudienceMessage(input)).not.toContain('widen the area')
    }
  })

  it('stays distinct from the polygon message', () => {
    expect(EMPTY_TURF_MESSAGE).not.toBe(
      emptyAudienceMessage(filter({ supportStatus: ['supporter'] })),
    )
  })
})
