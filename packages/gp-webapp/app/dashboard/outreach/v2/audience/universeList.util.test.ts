import { describe, expect, it } from 'vitest'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { isCriteriaFreeList, isUniverseList } from './universeList.util'

const list = (overrides: Record<string, unknown> = {}): SegmentResponse =>
  ({ id: 1, name: 'A list', ...overrides }) as SegmentResponse

describe('isCriteriaFreeList', () => {
  it('accepts a list with nothing set on it', () => {
    expect(isCriteriaFreeList(list())).toBe(true)
  })

  // Every criterion is a boolean defaulting to false, so an untouched saved
  // list arrives carrying dozens of them. That is still everyone.
  it('accepts a list whose criteria are all false', () => {
    expect(
      isCriteriaFreeList(
        list({
          partyDemocrat: false,
          age18_25: false,
          hasCellPhone: false,
          audienceSuperVoters: false,
        }),
      ),
    ).toBe(true)
  })

  // The finding this exists for: a candidate may legitimately name a filtered
  // list "All voters", and reusing it would send a campaign that promised
  // everyone to a subset instead.
  it('refuses a filtered list, whatever it is called', () => {
    expect(
      isCriteriaFreeList(list({ name: 'All voters', partyDemocrat: true })),
    ).toBe(false)
    expect(
      isCriteriaFreeList(list({ name: 'All constituents', age65Plus: true })),
    ).toBe(false)
  })

  // A criterion added to voter_file_filter later is a boolean too, so it is
  // caught without this file having to learn its name.
  it('refuses a criterion it has never heard of', () => {
    expect(isCriteriaFreeList(list({ someFutureCriterion: true }))).toBe(false)
  })

  it.each([
    ['a search term', { search: 'smith' }],
    ['a drawn boundary', { geoPoly: { type: 'Polygon', coordinates: [] } }],
    ['a support status', { supportStatus: ['supporter'] }],
    ['an activity condition', { activityConditions: [{ channel: 'sms' }] }],
    ['precincts', { precincts: ['0012'] }],
  ])('refuses a list narrowed by %s', (_label, overrides) => {
    expect(isCriteriaFreeList(list(overrides))).toBe(false)
  })

  // Empty carriers are not criteria — a saved list can round-trip these as
  // empty arrays, and treating that as filtered would create a duplicate
  // universe list on every pick.
  it('ignores empty carriers', () => {
    expect(
      isCriteriaFreeList(
        list({
          search: null,
          geoPoly: null,
          supportStatus: [],
          activityConditions: [],
          precincts: [],
        }),
      ),
    ).toBe(true)
  })
})

// Both halves are load-bearing, and the suite caught the version of this that
// dropped the name: any criteria-free list a candidate saved under their own
// name was co-opted as the universe and vanished from the picker's rows.
describe('isUniverseList', () => {
  it('recognizes our own label with no criteria on it', () => {
    expect(isUniverseList(list({ name: 'All voters' }), 'All voters')).toBe(
      true,
    )
  })

  it('refuses our label on a filtered list', () => {
    expect(
      isUniverseList(
        list({ name: 'All voters', partyDemocrat: true }),
        'All voters',
      ),
    ).toBe(false)
  })

  it("refuses a candidate's own criteria-free list", () => {
    expect(
      isUniverseList(list({ name: 'Everyone on my street' }), 'All voters'),
    ).toBe(false)
  })

  it('is keyed to the surface label, so Serve and Win do not cross', () => {
    expect(
      isUniverseList(list({ name: 'All voters' }), 'All constituents'),
    ).toBe(false)
  })
})
