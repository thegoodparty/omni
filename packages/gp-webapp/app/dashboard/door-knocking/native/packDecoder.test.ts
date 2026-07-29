import { describe, expect, it } from 'vitest'
import { decodePack } from './packDecoder'
import { DimSelections, polygonStats, runFilter } from './filterEngine'

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
    const all = runFilter(pack, new Map())

    // Ring around dot 0 only.
    const ring: Array<[number, number]> = [
      [-87.655, 41.895],
      [-87.645, 41.895],
      [-87.645, 41.905],
      [-87.655, 41.905],
      [-87.655, 41.895],
    ]
    expect(polygonStats(pack, all.matchedPerDot, ring)).toEqual({
      stops: 1,
      people: 3,
    })
  })
})
