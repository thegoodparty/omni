import { describe, expect, it } from 'vitest'
import { applyLoggedKnocks, runFilter } from './filterEngine'
import type { DecodedPack, LoggedKnock } from './packDecoder'

// Two dots, three households, four people. Dot 0 carries households 0 and 1
// (two doors at one coordinate — the multi-unit case the pack cannot tell
// apart, since it groups at AddressLine); dot 1 carries household 2 alone.
// Person 0 has been logged as a supporter and the other three are unanswered,
// so the pack's own rollup leaves both dots on `unknown`.
const pack = (): DecodedPack => ({
  manifest: {
    version: 1,
    generatedAt: '2026-09-01T12:00:00Z',
    counts: { people: 4, households: 3, dots: 2 },
    dims: [
      { key: 'canvassStatus', values: ['unknown', 'not_home', 'supporter'] },
    ],
    arrays: [],
  } as unknown as DecodedPack['manifest'],
  positions: new Float32Array([-87.65, 41.9, -87.66, 41.91]),
  personToHousehold: new Uint32Array([0, 0, 1, 2]),
  householdToDot: new Uint32Array([0, 0, 1]),
  dimPlanes: new Map([['canvassStatus', new Uint8Array([2, 0, 0, 0])]]),
})

const knock = (lng: number, lat: number, status: number): LoggedKnock => ({
  lng,
  lat,
  status,
})

const withKnocks = (knocks: LoggedKnock[]): DecodedPack => ({
  ...pack(),
  loggedKnocks: knocks,
})

const statuses = (decoded: DecodedPack): number[] =>
  Array.from(
    applyLoggedKnocks(decoded, runFilter(decoded, new Map())).statusPerDot,
  )

describe('applyLoggedKnocks', () => {
  it('leaves a pack with no logged doors exactly as the filter reported it', () => {
    const decoded = pack()
    const result = runFilter(decoded, new Map())

    expect(applyLoggedKnocks(decoded, result)).toBe(result)
  })

  // The stop's lat/lng is a double and the pack's is an f32 of the same
  // people_db column, so the join only lands once both have been through the
  // same narrowing. Getting this wrong is silent: every door misses its dot and
  // the map simply never changes.
  it('lands a logged door on the dot at its coordinate', () => {
    expect(statuses(withKnocks([knock(-87.65, 41.9, 1)]))).toEqual([1, 0])
  })

  // A knock can only ever make a door LESS actionable, and `runFilter` reports
  // the most actionable status at a dot — so this is a floor and never a
  // rewrite. Dot 0's household 0 is already a supporter (2) in the pack, and a
  // later `not_home` (1) at the same coordinate must not walk that back.
  it('never makes a dot more actionable than the pack already found it', () => {
    const decoded = withKnocks([knock(-87.65, 41.9, 1)])
    // Everyone at dot 0 answered as a supporter, so the pack's own rollup is 2.
    decoded.dimPlanes.set('canvassStatus', new Uint8Array([2, 2, 2, 0]))

    expect(statuses(decoded)).toEqual([2, 0])
  })

  // Two doors at one coordinate is the ordinary block of flats. The most
  // actionable of them wins, which is the same rule `runFilter` rolls a dot's
  // people up by — a building with an unanswered door is still worth a visit.
  it('takes the most actionable status among doors sharing a coordinate', () => {
    expect(
      statuses(withKnocks([knock(-87.65, 41.9, 5), knock(-87.65, 41.9, 1)])),
    ).toEqual([1, 0])
  })

  // A route frozen against a district the pack no longer describes, or a
  // coordinate that simply is not a dot. Dropping it degrades to the map the
  // candidate had; guessing at a nearby dot would colour someone else's house.
  it('drops a door whose coordinate is not a dot', () => {
    expect(statuses(withKnocks([knock(-86.78, 36.16, 1)]))).toEqual([0, 0])
  })

  it('leaves the people and household counts alone', () => {
    const decoded = withKnocks([knock(-87.65, 41.9, 1)])
    const result = applyLoggedKnocks(decoded, runFilter(decoded, new Map()))

    expect(result.people).toBe(4)
    expect(result.households).toBe(3)
  })
})
