import { describe, expect, it } from 'vitest'
import { applyLoggedKnocks, polygonStats, runFilter } from './filterEngine'
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

  // The bytes are indices into `DOOR_KNOCK_STATUSES`, which the two Serve
  // statuses were APPENDED to so that packs already on phones keep decoding —
  // so byte order is not actionability order, and every comparison here goes
  // through `statusByteActionability`. Read raw, `engaged` (7) would lose to
  // `refused` (5) at a shared coordinate and a Serve dot where a conversation
  // happened would print black.
  it('ranks the appended Serve statuses by actionability, not by byte', () => {
    expect(
      statuses(withKnocks([knock(-87.65, 41.9, 5), knock(-87.65, 41.9, 7)])),
    ).toEqual([7, 0])
  })

  // The same table on the floor side, where the comparison runs the other way:
  // a knock lands only if it makes the dot LESS actionable. Dot 1 is `unknown`
  // (0) in the pack and a Serve conversation happened there, so `engaged` (7)
  // lands — by rank, 2 over 0, which is the same answer `supporter` would get
  // and the point of the table.
  it('floors a dot by rank rather than by byte value', () => {
    expect(statuses(withKnocks([knock(-87.66, 41.91, 7)]))).toEqual([0, 7])
  })

  it('leaves the people and household counts alone', () => {
    const decoded = withKnocks([knock(-87.65, 41.9, 1)])
    const result = applyLoggedKnocks(decoded, runFilter(decoded, new Map()))

    expect(result.people).toBe(4)
    expect(result.households).toBe(3)
  })
})

describe('the knockable mask', () => {
  // Do-not-knock (ADR 0007) and not-a-voter (ADR 0008) are suppression, not
  // criteria: every server-side evaluation drops these people before it
  // counts anything, and the map was the last surface still drawing them.
  // So the plane is read here as a mask rather than through `selections` —
  // nothing selects it and there is no pill to clear.
  const suppressing = (plane: number[]): DecodedPack => {
    const decoded = pack()
    decoded.manifest.dims = [
      ...decoded.manifest.dims,
      { key: 'knockable', values: ['No', 'Yes'] },
    ]
    decoded.dimPlanes.set('knockable', new Uint8Array(plane))
    return decoded
  }

  // The whole ring, so the only thing that can change the counts is the mask.
  const ring: Array<[number, number]> = [
    [-88, 41],
    [-87, 41],
    [-87, 42],
    [-88, 42],
  ]

  it('drops suppressed people from the district counts', () => {
    // Person 0 is flagged. They share household 0 with person 1, so the
    // household survives and only the person count moves — which is the
    // point: a door with somebody else behind it is still a door.
    const before = runFilter(pack(), new Map())
    const after = runFilter(suppressing([0, 1, 1, 1]), new Map())

    expect(before.people).toBe(4)
    expect(after.people).toBe(3)
    expect(after.households).toBe(3)
  })

  it('drops a household once every person behind it is suppressed', () => {
    // Both residents of household 0 flagged. Nobody is left to knock, so the
    // door goes too, and with it the dot's share of the count.
    const after = runFilter(suppressing([0, 0, 1, 1]), new Map())

    expect(after.people).toBe(2)
    expect(after.households).toBe(2)
    expect(Array.from(after.matchedPerDot)).toEqual([1, 1])
  })

  it('drops them from a drawn turf as well as the district', () => {
    // The two counts are read by different surfaces — the who step's total
    // and the draw step's stops — and a mask applied to one only would put
    // them back in disagreement.
    const before = polygonStats(pack(), new Map(), ring)
    const after = polygonStats(suppressing([0, 0, 1, 1]), new Map(), ring)

    expect(before.people).toBe(4)
    expect(after.people).toBe(2)
    expect(after.households).toBe(2)
    expect(after.stops).toBe(2)
  })

  it('suppresses nobody when the pack carries no plane', () => {
    // Absent means gp-api could not answer, and the honest fallback is the
    // status quo rather than hiding doors on a guess. The walk still drops
    // these people, because its route was frozen server-side.
    expect(runFilter(pack(), new Map()).people).toBe(4)
    expect(polygonStats(pack(), new Map(), ring).people).toBe(4)
  })
})
