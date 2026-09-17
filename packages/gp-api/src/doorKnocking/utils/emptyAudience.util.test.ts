import { describe, expect, it } from 'vitest'
import { emptyAudienceMessage, emptyTurfMessage } from './emptyAudience.util'
import type { ContactsFilterResolutionInput } from '@/contacts/services/contacts.service'

const filter = (
  overrides: Partial<ContactsFilterResolutionInput> = {},
): ContactsFilterResolutionInput => overrides as ContactsFilterResolutionInput

describe('emptyAudienceMessage', () => {
  it('names the criterion a list was cut by', () => {
    expect(
      emptyAudienceMessage(filter({ supportStatus: ['supporter'] }), false),
    ).toBe(
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
      false,
    )
    expect(message).toContain('previous outreach')
  })

  it('reads contacts made off any of its six bucket columns', () => {
    expect(
      emptyAudienceMessage(filter({ contactsMade5Plus: true }), false),
    ).toContain('contacts made')
    expect(
      emptyAudienceMessage(filter({ contactsMade0: true }), false),
    ).toContain('contacts made')
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
      false,
    )
    expect(message).toContain(
      'support status, previous outreach and contacts made',
    )
  })

  it('falls back to the plain noun when no emptiable criterion is set', () => {
    // Should not be reachable: a list carrying none of the three resolves to
    // a column predicate, and no rows back is the polygon case. Worth a
    // sentence rather than an empty one if it ever is.
    expect(emptyAudienceMessage(filter({ partyDemocrat: true }), false)).toBe(
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
      expect(emptyAudienceMessage(input, false)).not.toContain('turf')
      expect(emptyAudienceMessage(input, false)).not.toContain('widen the area')
    }
  })

  it('stays distinct from the polygon message', () => {
    expect(emptyTurfMessage(false)).not.toBe(
      emptyAudienceMessage(filter({ supportStatus: ['supporter'] }), false),
    )
  })

  // These sentences are the ones a create failure puts in front of a user, so
  // they carry the surface's noun — an elected official is never told about
  // voters. The diagnosis each one makes is unchanged.
  it('says constituents on serve, in all three sentences', () => {
    const named = emptyAudienceMessage(
      filter({ supportStatus: ['supporter'] }),
      true,
    )
    expect(named).toBe(
      "No constituents match this list's support status filters — edit the list or pick a different audience",
    )
    expect(emptyAudienceMessage(filter(), true)).toBe(
      "No constituents match this list's filters — edit the list or pick a different audience",
    )
    expect(emptyTurfMessage(true)).toBe(
      'No matching constituents inside this turf — widen the area or the filters',
    )

    for (const message of [named, emptyTurfMessage(true)]) {
      expect(message).not.toMatch(/\bvoters?\b/i)
    }
  })
})
