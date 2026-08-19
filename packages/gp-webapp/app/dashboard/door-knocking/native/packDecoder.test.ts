import { describe, expect, it } from 'vitest'
import { decodePack } from './packDecoder'
import {
  canvassStatusCounts,
  DimSelections,
  maskToPolygon,
  polygonStats,
  runFilter,
} from './filterEngine'

// Hand-built pack matching the wire framing: 4 people, 3 households, 2 dots,
// three dims (party, age, canvassStatus). Mirrors the people-api encoder
// layout.
const buildFixture = (): ArrayBuffer => {
  const counts = { people: 4, households: 3, dots: 2 }
  const positions = new Float32Array([-87.65, 41.9, -87.66, 41.91])
  const personToHousehold = new Uint32Array([0, 0, 1, 2])
  const householdToDot = new Uint32Array([0, 0, 1])
  const party = new Uint8Array([1, 2, 0, 0]) // Dem, Rep, Unknown, Unknown
  // Deliberately a different shape from `party` — same four people bucketed
  // unevenly — so a stat that read the wrong plane produces the wrong answer
  // rather than coincidentally the right one.
  const age = new Uint8Array([3, 1, 3, 0]) // 35_50, 18_25, 35_50, Unknown
  const canvass = new Uint8Array([2, 0, 0, 0]) // supporter, unknown...

  const pad4 = (n: number) => Math.ceil(n / 4) * 4
  const arraysBytes =
    positions.byteLength +
    personToHousehold.byteLength +
    householdToDot.byteLength +
    party.byteLength +
    age.byteLength +
    canvass.byteLength

  let dataStart = 4
  let manifestJson = ''
  for (;;) {
    const arrays: Array<{
      name: string
      type: string
      byteOffset: number
      elementCount: number
    }> = []
    let offset = dataStart
    const push = (name: string, type: string, count: number, width: number) => {
      arrays.push({ name, type, byteOffset: offset, elementCount: count })
      offset += count * width
    }
    push('positions', 'f32', positions.length, 4)
    push('personToHousehold', 'u32', counts.people, 4)
    push('householdToDot', 'u32', counts.households, 4)
    push('dim:party', 'u8', counts.people, 1)
    push('dim:age', 'u8', counts.people, 1)
    push('dim:canvassStatus', 'u8', counts.people, 1)
    manifestJson = JSON.stringify({
      version: 1,
      generatedAt: '2026-07-21T12:00:00Z',
      counts,
      dims: [
        { key: 'party', values: ['Unknown', 'Democratic', 'Republican'] },
        // gp-api's AGE_VALUES, in its order — the byte IS the index into this.
        {
          key: 'age',
          values: ['Unknown', '18_25', '25_35', '35_50', '50_plus'],
        },
        {
          key: 'canvassStatus',
          values: ['unknown', 'not_home', 'supporter'],
        },
      ],
      arrays,
    })
    const needed = 4 + pad4(new TextEncoder().encode(manifestJson).length)
    if (needed <= dataStart) break
    dataStart = needed
  }

  const manifestBytes = new TextEncoder().encode(manifestJson)
  const buffer = new ArrayBuffer(dataStart + arraysBytes)
  new DataView(buffer).setUint32(0, manifestBytes.length, true)
  new Uint8Array(buffer).set(manifestBytes, 4)
  let offset = dataStart
  const write = (view: ArrayBufferView) => {
    new Uint8Array(buffer).set(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      offset,
    )
    offset += view.byteLength
  }
  write(positions)
  write(personToHousehold)
  write(householdToDot)
  write(party)
  write(age)
  write(canvass)
  return buffer
}

describe('decodePack', () => {
  it('mounts typed-array views at the manifest offsets', () => {
    const pack = decodePack(buildFixture())

    expect(pack.manifest.counts).toEqual({ people: 4, households: 3, dots: 2 })
    expect(Array.from(pack.personToHousehold)).toEqual([0, 0, 1, 2])
    expect(Array.from(pack.householdToDot)).toEqual([0, 0, 1])
    expect(pack.positions[0]).toBeCloseTo(-87.65, 4)
    expect(Array.from(pack.dimPlanes.get('party') ?? [])).toEqual([1, 2, 0, 0])
  })

  it('throws on a pack missing a core array', () => {
    const buffer = buildFixture()
    // Corrupt the manifest: rename positions.
    const manifestBytes = new DataView(buffer).getUint32(0, true)
    const json = new TextDecoder().decode(
      new Uint8Array(buffer, 4, manifestBytes),
    )
    const broken = json.replace('"positions"', '"positionsX"')
    const brokenBuffer = buffer.slice(0)
    new Uint8Array(brokenBuffer).set(new TextEncoder().encode(broken), 4)
    expect(() => decodePack(brokenBuffer)).toThrow()
  })
})

describe('runFilter + polygonStats', () => {
  it('applies dim masks and rolls up per-dot counts and statuses', () => {
    const pack = decodePack(buildFixture())

    const all = runFilter(pack, new Map())
    expect(all).toMatchObject({ people: 4, households: 3 })
    // Dot 0 holds a supporter (byte 2) and unknowns — most actionable wins.
    expect(all.statusPerDot[0]).toBe(0)

    const demsOnly: DimSelections = new Map([['party', new Set([1])]])
    const filtered = runFilter(pack, demsOnly)
    expect(filtered).toMatchObject({ people: 1, households: 1 })
    expect(filtered.matchedPerDot[0]).toBe(1)
    expect(filtered.matchedPerDot[1]).toBe(0)
    // The only matched person at dot 0 is the supporter now.
    expect(filtered.statusPerDot[0]).toBe(2)
  })

  it('counts stops and voters inside a drawn ring', () => {
    const pack = decodePack(buildFixture())

    // Ring around dot 0 only.
    const ring: Array<[number, number]> = [
      [-87.655, 41.895],
      [-87.645, 41.895],
      [-87.645, 41.905],
      [-87.655, 41.905],
      [-87.655, 41.895],
    ]
    expect(polygonStats(pack, new Map(), ring)).toMatchObject({
      stops: 1,
      people: 3,
    })
  })
})

describe('polygonStats', () => {
  // Fixture geography: dot 0 at (-87.65, 41.9) carries households 0 and 1
  // (persons 0-2), dot 1 at (-87.66, 41.91) carries household 2 (person 3).
  const dotZeroRing: Array<[number, number]> = [
    [-87.655, 41.895],
    [-87.645, 41.895],
    [-87.645, 41.905],
    [-87.655, 41.905],
    [-87.655, 41.895],
  ]
  const wholeDistrictRing: Array<[number, number]> = [
    [-87.67, 41.89],
    [-87.64, 41.89],
    [-87.64, 41.92],
    [-87.67, 41.92],
    [-87.67, 41.89],
  ]

  // The draw step reports households and doors side by side at the moment of
  // commitment, so they have to share a denominator. This is the regression
  // that shipped: the count came off a district-wide runFilter, which the
  // create flow never narrowed to the polygon.
  it('reports households inside the ring, not across the district', () => {
    const pack = decodePack(buildFixture())

    const district = runFilter(pack, new Map())
    expect(district.households).toBe(3)

    // Households 0 and 1 sit at dot 0; household 2 is outside the ring.
    expect(polygonStats(pack, new Map(), dotZeroRing).households).toBe(2)
  })

  // Same audience, same ring: the number the draw step shows must be the one
  // runFilter would report for that audience, only restricted to the polygon.
  it('counts a household only when one of its people survives the filter', () => {
    const pack = decodePack(buildFixture())
    const demsOnly: DimSelections = new Map([['party', new Set([1])]])

    const stats = polygonStats(pack, demsOnly, dotZeroRing)

    // Only person 0 is Democratic, and they live in household 0 — so the
    // Republican's household 1 at the same dot must not be counted.
    expect(stats).toMatchObject({ stops: 1, people: 1, households: 1 })
  })

  it('breaks the ring down by party, biggest bucket first', () => {
    const pack = decodePack(buildFixture())

    const stats = polygonStats(pack, new Map(), wholeDistrictRing)

    // Persons 2 and 3 are Unknown, person 0 Democratic, person 1 Republican.
    expect(stats.partyMix).toEqual([
      { label: 'Unknown', people: 2 },
      { label: 'Democratic', people: 1 },
      { label: 'Republican', people: 1 },
    ])
  })

  it('drops party buckets the filter excluded rather than showing them at zero', () => {
    const pack = decodePack(buildFixture())
    const demsOnly: DimSelections = new Map([['party', new Set([1])]])

    expect(polygonStats(pack, demsOnly, wholeDistrictRing).partyMix).toEqual([
      { label: 'Democratic', people: 1 },
    ])
  })

  // Age is the details sheet's second breakdown and reads its own plane, so it
  // gets the same three assertions party does. The fixture buckets the four
  // people differently across the two dims on purpose: a stat that read the
  // party plane for age would otherwise still produce a plausible answer.
  it('breaks the ring down by age, biggest bucket first', () => {
    const pack = decodePack(buildFixture())

    const stats = polygonStats(pack, new Map(), wholeDistrictRing)

    // Persons 0 and 2 are 35_50, person 1 is 18_25, person 3 Unknown — and the
    // labels are the manifest's raw bucket keys, which the sheet formats.
    // The two one-person buckets tie, and the sort is stable, so they hold
    // manifest order (Unknown is index 0) rather than an arbitrary one.
    expect(stats.ageMix).toEqual([
      { label: '35_50', people: 2 },
      { label: 'Unknown', people: 1 },
      { label: '18_25', people: 1 },
    ])
  })

  it('counts age only for the people inside the ring', () => {
    const pack = decodePack(buildFixture())

    // Dot 0 holds households 0 and 1, i.e. persons 0, 1 and 2.
    expect(polygonStats(pack, new Map(), dotZeroRing).ageMix).toEqual([
      { label: '35_50', people: 2 },
      { label: '18_25', people: 1 },
    ])
  })

  it('drops age buckets the filter excluded rather than showing them at zero', () => {
    const pack = decodePack(buildFixture())
    const demsOnly: DimSelections = new Map([['party', new Set([1])]])

    // Person 0 is the only Democrat, and they are 35_50 — so the other three
    // age buckets go, rather than reporting the polygon's whole age spread
    // beside a people count of 1.
    expect(polygonStats(pack, demsOnly, wholeDistrictRing).ageMix).toEqual([
      { label: '35_50', people: 1 },
    ])
  })

  it('returns an empty turf when the ring encloses no dot', () => {
    const pack = decodePack(buildFixture())

    const elsewhere: Array<[number, number]> = [
      [-87.7, 41.8],
      [-87.69, 41.8],
      [-87.69, 41.81],
      [-87.7, 41.81],
      [-87.7, 41.8],
    ]
    expect(polygonStats(pack, new Map(), elsewhere)).toEqual({
      stops: 0,
      people: 0,
      households: 0,
      partyMix: [],
      ageMix: [],
    })
  })
})

describe('canvassStatusCounts', () => {
  // Fixture statuses: person 0 is a supporter, persons 1-3 are unknown. Dot 0
  // holds persons 0-2; person 3 lives at dot 1, outside the ring below.
  const dotZeroRing: Array<[number, number]> = [
    [-87.655, 41.895],
    [-87.645, 41.895],
    [-87.645, 41.905],
    [-87.655, 41.905],
    [-87.655, 41.895],
  ]

  it('counts the whole pack when there is no turf selected', () => {
    const pack = decodePack(buildFixture())

    // Dim order is ['unknown', 'not_home', 'supporter'].
    expect(canvassStatusCounts(pack, new Map(), null)).toEqual([3, 0, 1])
  })

  // The bug this exists to prevent: the rail's heading and its "N voters in
  // this list" line rescoped to the selected turf while the seven legend
  // counts underneath stayed district-wide.
  it('rescopes to the selected turf rather than reporting the district', () => {
    const pack = decodePack(buildFixture())

    const scoped = canvassStatusCounts(pack, new Map(), dotZeroRing)

    // Person 3 is unknown and sits outside the ring, so unknown drops 3 -> 2.
    expect(scoped).toEqual([2, 0, 1])
  })

  // The legend has to add up to the number printed above it, or one of the two
  // is lying about the same audience.
  it('sums to the people count the rail heading reports for that turf', () => {
    const pack = decodePack(buildFixture())
    const demsOnly: DimSelections = new Map([['party', new Set([1])]])

    const scoped = canvassStatusCounts(pack, new Map(), dotZeroRing)
    const railPeople = maskToPolygon(
      pack,
      runFilter(pack, new Map()),
      dotZeroRing,
    ).people
    expect(scoped.reduce((sum, count) => sum + count, 0)).toBe(railPeople)

    // And again once the list carries filters of its own: only person 0 (the
    // supporter) is Democratic.
    const filtered = canvassStatusCounts(pack, demsOnly, dotZeroRing)
    expect(filtered).toEqual([0, 0, 1])
    expect(filtered.reduce((sum, count) => sum + count, 0)).toBe(
      maskToPolygon(pack, runFilter(pack, demsOnly), dotZeroRing).people,
    )
  })

  // A status chip narrows the map WITHIN the selected list, which only works
  // because no saved-list filter maps onto canvassStatus — the page merges the
  // chip into the list's own selections rather than replacing them.
  it('intersects with a turf ring when a status chip narrows inside it', () => {
    const pack = decodePack(buildFixture())
    const unknownOnly: DimSelections = new Map([
      ['canvassStatus', new Set([0])],
    ])

    // District-wide there are 3 unknowns; inside the turf there are 2.
    expect(runFilter(pack, unknownOnly).people).toBe(3)
    expect(
      maskToPolygon(pack, runFilter(pack, unknownOnly), dotZeroRing).people,
    ).toBe(2)
    // And the counts themselves intersect the same way: the supporter at dot 0
    // drops out, leaving only the two unknowns the chip asked for.
    expect(canvassStatusCounts(pack, unknownOnly, dotZeroRing)).toEqual([
      2, 0, 0,
    ])
  })
})

describe('maskToPolygon', () => {
  // Fixture geography: dot 0 at (-87.65, 41.9) carries households 0 and 1
  // (persons 0-2), dot 1 at (-87.66, 41.91) carries household 2 (person 3).
  const dotZeroRing: Array<[number, number]> = [
    [-87.655, 41.895],
    [-87.645, 41.895],
    [-87.645, 41.905],
    [-87.655, 41.905],
    [-87.655, 41.895],
  ]

  it('keeps dots inside the ring and zeroes the ones outside', () => {
    const pack = decodePack(buildFixture())
    const all = runFilter(pack, new Map())

    const masked = maskToPolygon(pack, all, dotZeroRing)

    expect(masked.matchedPerDot[0]).toBe(all.matchedPerDot[0])
    expect(masked.matchedPerDot[1]).toBe(0)
    expect(masked.people).toBe(3)
    // Statuses survive for kept dots and reset to the 255 sentinel otherwise,
    // so the excluded dot renders as absent rather than as 'unknown' (0).
    expect(masked.statusPerDot[0]).toBe(all.statusPerDot[0])
    expect(masked.statusPerDot[1]).toBe(255)
  })

  // The bbox is only a prefilter, so a ring test that also clears the bbox
  // proves nothing about pointInRing. This triangle's bbox spans both dots
  // while the polygon itself encloses only dot 0: dot 1 sits just past the
  // hypotenuse (y = x + 129.56).
  it('excludes a dot inside the bounding box but outside the ring', () => {
    const pack = decodePack(buildFixture())
    const all = runFilter(pack, new Map())

    const triangle: Array<[number, number]> = [
      [-87.665, 41.895],
      [-87.645, 41.895],
      [-87.645, 41.915],
      [-87.665, 41.895],
    ]
    const masked = maskToPolygon(pack, all, triangle)

    expect(masked.matchedPerDot[0]).toBe(all.matchedPerDot[0])
    expect(masked.matchedPerDot[1]).toBe(0)
    expect(masked.people).toBe(3)
  })

  it('zeroes everything when the ring encloses no dot', () => {
    const pack = decodePack(buildFixture())
    const all = runFilter(pack, new Map())

    const elsewhere: Array<[number, number]> = [
      [-87.7, 41.8],
      [-87.69, 41.8],
      [-87.69, 41.81],
      [-87.7, 41.81],
      [-87.7, 41.8],
    ]
    const masked = maskToPolygon(pack, all, elsewhere)

    expect(masked.people).toBe(0)
    expect(Array.from(masked.matchedPerDot)).toEqual([0, 0])
  })

  // The rail prints `people` and nothing else off a masked result, so the mask
  // carries no household count at all rather than a dot-granular approximation
  // of one that only looked maintained.
  it('carries no household count', () => {
    const pack = decodePack(buildFixture())
    const demsOnly: DimSelections = new Map([['party', new Set([1])]])
    const filtered = runFilter(pack, demsOnly)
    expect(filtered.households).toBe(1)

    const masked = maskToPolygon(pack, filtered, dotZeroRing)

    expect(masked.households).toBeUndefined()
    expect(masked.people).toBe(1)
  })
})
