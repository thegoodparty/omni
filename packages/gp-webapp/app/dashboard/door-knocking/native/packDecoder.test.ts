import { describe, expect, it } from 'vitest'
import { decodePack } from './packDecoder'
import {
  DimSelections,
  maskToPolygon,
  polygonStats,
  runFilter,
} from './filterEngine'

// Hand-built pack matching the wire framing: 4 people, 3 households, 2 dots,
// two dims (party, canvassStatus). Mirrors the people-api encoder layout.
const buildFixture = (): ArrayBuffer => {
  const counts = { people: 4, households: 3, dots: 2 }
  const positions = new Float32Array([-87.65, 41.9, -87.66, 41.91])
  const personToHousehold = new Uint32Array([0, 0, 1, 2])
  const householdToDot = new Uint32Array([0, 0, 1])
  const party = new Uint8Array([1, 2, 0, 0]) // Dem, Rep, Unknown, Unknown
  const canvass = new Uint8Array([2, 0, 0, 0]) // supporter, unknown...

  const pad4 = (n: number) => Math.ceil(n / 4) * 4
  const arraysBytes =
    positions.byteLength +
    personToHousehold.byteLength +
    householdToDot.byteLength +
    party.byteLength +
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
    push('dim:canvassStatus', 'u8', counts.people, 1)
    manifestJson = JSON.stringify({
      version: 1,
      generatedAt: '2026-07-21T12:00:00Z',
      counts,
      dims: [
        { key: 'party', values: ['Unknown', 'Democratic', 'Republican'] },
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
    expect(all).toMatchObject({ people: 4, households: 3, dots: 2 })
    // Dot 0 holds a supporter (byte 2) and unknowns — most actionable wins.
    expect(all.statusPerDot[0]).toBe(0)

    const demsOnly: DimSelections = new Map([['party', new Set([1])]])
    const filtered = runFilter(pack, demsOnly)
    expect(filtered).toMatchObject({ people: 1, households: 1, dots: 1 })
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
    // Republican's household 1 at the same dot must not be counted. That is
    // stricter than maskToPolygon's dot-granular rollup, which returns 2 here.
    expect(stats).toMatchObject({ stops: 1, people: 1, households: 1 })
    expect(
      maskToPolygon(pack, runFilter(pack, demsOnly), dotZeroRing).households,
    ).toBe(2)
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
    })
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
    expect(masked).toMatchObject({ people: 3, dots: 1 })
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
    expect(masked).toMatchObject({ people: 3, dots: 1 })
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

    expect(masked).toMatchObject({ people: 0, households: 0, dots: 0 })
    expect(Array.from(masked.matchedPerDot)).toEqual([0, 0])
  })

  it('counts every household at a kept dot, overcounting by design', () => {
    const pack = decodePack(buildFixture())
    // Only person 0 (Democratic) matches, and person 0 lives in household 0.
    const demsOnly: DimSelections = new Map([['party', new Set([1])]])
    const filtered = runFilter(pack, demsOnly)
    expect(filtered.households).toBe(1)

    const masked = maskToPolygon(pack, filtered, dotZeroRing)

    // Households 0 and 1 both sit at dot 0, so the dot-granular rollup returns
    // 2 where runFilter's person-level pass returns 1. This is the documented
    // approximation for the rail readout — knock-time evaluation is canonical.
    expect(masked.households).toBe(2)
    expect(masked.people).toBe(1)
  })
})
