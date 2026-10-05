import { describe, expect, it } from 'vitest'
import type { SegmentResponse } from 'app/(dashboard)/contacts/crm/shared/contacts-types'
import type { DecodedPack } from '../packDecoder'
import { audienceOptions } from './savedListOptions'

// Four people across three households on two dots. Two of the three households
// are Democratic, which is what the counts below are measuring.
const pack = {
  manifest: {
    version: 1,
    generatedAt: '2026-08-20T12:00:00Z',
    counts: { people: 4, households: 3, dots: 2 },
    dims: [
      { key: 'party', values: ['Unknown', 'Democratic', 'Republican'] },
      { key: 'canvassStatus', values: ['unknown', 'not_home', 'supporter'] },
    ],
    arrays: [],
  },
  positions: new Float32Array([-87.65, 41.9, -87.66, 41.91]),
  personToHousehold: new Uint32Array([0, 0, 1, 2]),
  householdToDot: new Uint32Array([0, 0, 1]),
  dimPlanes: new Map([
    ['party', new Uint8Array([1, 1, 1, 2])],
    ['canvassStatus', new Uint8Array([0, 0, 0, 0])],
  ]),
} as unknown as DecodedPack

const list = (over: Partial<SegmentResponse>): SegmentResponse =>
  ({ id: 1, name: 'Saved list', ...over }) as SegmentResponse

describe('audienceOptions', () => {
  it('counts all contacts and each list district-wide, off the same pack pass', () => {
    const { allContactsHouseholds, lists } = audienceOptions(
      [list({ id: 4, name: 'Democrats', partyDemocrat: true })],
      pack,
    )

    expect(allContactsHouseholds).toBe(3)
    expect(lists).toEqual([
      {
        id: 4,
        name: 'Democrats',
        households: 2,
        filters: { partyDemocrat: true },
      },
    ])
  })

  // A count that arrives late is fine; a picker that hides its rows until the
  // pack decodes is not — the candidate would see an empty audience step and
  // conclude they have no lists.
  it('still offers every row before the pack has decoded', () => {
    const { allContactsHouseholds, lists } = audienceOptions(
      [list({ id: 4, name: 'Democrats', partyDemocrat: true })],
      null,
    )

    expect(allContactsHouseholds).toBeNull()
    expect(lists).toEqual([
      {
        id: 4,
        name: 'Democrats',
        households: null,
        filters: { partyDemocrat: true },
      },
    ])
  })

  it('drops a list with no name rather than rendering a blank row', () => {
    const { lists } = audienceOptions(
      [list({ id: 4, name: '' }), list({ id: 5, name: 'Named' })],
      pack,
    )

    expect(lists.map((option) => option.name)).toEqual(['Named'])
  })

  it('has nothing to offer beyond all contacts when there are no lists', () => {
    expect(audienceOptions(undefined, pack)).toEqual({
      allContactsHouseholds: 3,
      lists: [],
    })
  })

  // Re-expanded through the shared `savedListFilterKeys`, so picking a list
  // seeds the draft with exactly the pills the CRM saved — income and language
  // included, which the backend stores as string arrays rather than booleans.
  it('re-expands a list’s stored ranges into the pills the draft speaks', () => {
    const { lists } = audienceOptions(
      [list({ id: 7, name: 'Spanish speakers', languageCodes: ['es'] })],
      pack,
    )

    expect(lists[0]?.filters).toEqual({ languageSpanish: true })
  })

  it('narrows a list by its precincts, not just its boolean pills', () => {
    // The precinct values are not boolean keys, so they do not arrive in
    // `savedListFilterKeys` — they travel beside it and have to be handed to
    // `filtersToDimSelections` separately. Missing that here was worse than
    // an unnarrowed count: once the pack can shade precinct,
    // `narrowsPreview` stops flagging the key, so the row would report the
    // whole district with the disclosure that used to cover it silenced.
    const withPrecinct = {
      ...pack,
      manifest: {
        ...pack.manifest,
        dims: [
          ...pack.manifest.dims,
          {
            key: 'precinct',
            values: ['Unknown', 'Brevard|300', 'Brevard|301'],
          },
        ],
      },
      dimPlanes: new Map([
        ...pack.dimPlanes,
        // People 0 and 1 share household 0 and sit in 300; people 2 and 3
        // are in 301, in households 1 and 2.
        ['precinct', new Uint8Array([1, 1, 2, 2])],
      ]),
    } as unknown as DecodedPack

    const { lists } = audienceOptions(
      [list({ id: 7, name: 'Ward 1', precincts: ['Brevard|300'] })],
      withPrecinct,
    )

    expect(lists[0]?.households).toBe(1)
  })
})
