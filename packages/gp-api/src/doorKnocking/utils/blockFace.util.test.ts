import { describe, expect, it } from 'vitest'
import {
  BlockFaceStop,
  coordinateKey,
  groupIntoBlockFaces,
  representativeOf,
  sequenceBlockFaces,
} from './blockFace.util'

// A door, with no unit under it unless one is given. `addressKey` only matters
// here for taking a unit back off the frozen line, so a household-era single
// segment (which names no unit) is the quiet default.
const stop = (
  displayAddress: string,
  lat: number,
  lng: number,
  apartments: string[] = [],
): BlockFaceStop => ({
  lat,
  lng,
  displayAddress,
  people:
    apartments.length > 0
      ? apartments.map((apartment) => ({
          addressKey: `${displayAddress.toUpperCase()}|${apartment}|97213`,
        }))
      : [{ addressKey: displayAddress.toUpperCase() }],
})

// NE 64th Ave runs north-south, so its two sides are two longitudes about a
// street apart. The three addresses QA filmed, at the spacing the screenshot
// implies: 3620 and 3630 a few doors apart on the even side, 3629 across.
const EVEN_SIDE_LNG = -122.6
const ODD_SIDE_LNG = -122.6003
const qaStops = [
  stop('3620 NE 64th Ave', 45.56, EVEN_SIDE_LNG),
  stop('3629 NE 64th Ave', 45.5601, ODD_SIDE_LNG),
  stop('3630 NE 64th Ave', 45.5602, EVEN_SIDE_LNG),
]

// The order a full plan would freeze, so the tests can read walk order the way
// a canvasser does. Vendor face order and its legs are the caller's to supply;
// these default to "faces in the order they were grouped, no measured legs".
const walkOrder = (
  stops: BlockFaceStop[],
  options: {
    faceOrder?: number[]
    faceLegSeconds?: number[]
    faceLegMeters?: number[]
    loop?: boolean
  } = {},
) => {
  const faces = groupIntoBlockFaces(stops)
  const faceOrder = options.faceOrder ?? faces.map((_, index) => index)
  const sequenced = sequenceBlockFaces({
    stops,
    faces,
    faceOrder,
    faceLegSeconds: options.faceLegSeconds ?? faceOrder.map(() => 0),
    faceLegMeters: options.faceLegMeters ?? faceOrder.map(() => 0),
    mode: 'walk',
    loop: options.loop ?? false,
  })
  return {
    faces,
    sequenced,
    addresses: sequenced.stopIndexes.map(
      (index) => stops[index]?.displayAddress,
    ),
  }
}

describe('groupIntoBlockFaces', () => {
  it('splits a street by house-number parity', () => {
    const faces = groupIntoBlockFaces(qaStops)

    expect(faces.map((face) => face.key)).toEqual([
      'NE 64TH AVE|0',
      'NE 64TH AVE|1',
    ])
    // Index 0 is 3620 and index 2 is 3630 — both even, one face.
    expect(faces[0]?.stopIndexes).toEqual([0, 2])
    expect(faces[1]?.stopIndexes).toEqual([1])
  })

  it('orders a face by house number, not by input order', () => {
    const faces = groupIntoBlockFaces([
      stop('105 W Elm St', 41.902, -87.65),
      stop('101 W Elm St', 41.9, -87.65),
      stop('103 W Elm St', 41.901, -87.65),
    ])

    expect(faces).toHaveLength(1)
    expect(faces[0]?.stopIndexes).toEqual([1, 2, 0])
  })

  // Lexicographic addressKey order — what buildStops sorts by — puts 1000
  // before 999. Grouping has to read the number as a number.
  it('sorts house numbers numerically', () => {
    const faces = groupIntoBlockFaces([
      stop('999 W Elm St', 41.9, -87.65),
      stop('1001 W Elm St', 41.91, -87.65),
    ])

    expect(faces[0]?.stopIndexes).toEqual([0, 1])
  })

  it.each([
    // On the Utah grid the directions carry the address and the street "name"
    // is itself a number — fine as an opaque group key, fatal to any parser
    // that tries to understand it.
    ['the Utah grid', '1234 S 5678 W', 'S 5678 W|0'],
    ['a street named for a direction', '742 NORTH AVE', 'NORTH AVE|0'],
    ['a prefix directional', '1235 S MAIN ST', 'S MAIN ST|1'],
    ['a suffix directional', '1234 MAIN ST W', 'MAIN ST W|0'],
    ['no directional at all', '1234 MAIN ST', 'MAIN ST|0'],
    // Queens-style hyphenated and letter-suffixed numbers still yield the
    // integer they sort by.
    ['a hyphenated house number', '45-10 MAIN ST', 'MAIN ST|1'],
    ['a letter-suffixed house number', '1234B MAIN ST', 'MAIN ST|0'],
  ])('reads %s', (_label, displayAddress, key) => {
    expect(groupIntoBlockFaces([stop(displayAddress, 41.9, -87.65)])).toEqual([
      { key, stopIndexes: [0] },
    ])
  })

  // The unit is subtracted using the stop's own doors rather than guessed by
  // shape, so an apartment number cannot end up in the street key and split a
  // building off its own block.
  it('groups an apartment building by its street, not its units', () => {
    const faces = groupIntoBlockFaces([
      stop('205 BENTON DR APT 8309', 41.9, -87.65, ['8309', '8311']),
      stop('207 BENTON DR', 41.901, -87.65),
    ])

    expect(faces.map((face) => face.key)).toEqual(['BENTON DR|1'])
    expect(faces[0]?.stopIndexes).toEqual([0, 1])
  })

  // A line no number can be read out of keeps the behaviour it has today:
  // one job of its own, ordered by the vendor.
  it('gives a line with no house number a face to itself', () => {
    const faces = groupIntoBlockFaces([
      stop('101 W Elm St', 41.9, -87.65),
      stop('RURAL ROUTE 3', 41.95, -87.6),
      stop('103 W Elm St', 41.901, -87.65),
    ])

    expect(faces.map((face) => face.key)).toEqual(['W ELM ST|1', '?1'])
    expect(faces[1]?.stopIndexes).toEqual([1])
  })
})

describe('coordinateKey', () => {
  // Two voter rows for one building, differing in the last decimal. These used
  // to be two stops the planner could put a trip across the street between.
  it('collapses coordinates under a metre apart', () => {
    expect(coordinateKey(41.9000001, -87.65)).toBe(coordinateKey(41.9, -87.65))
  })

  it('keeps neighbouring buildings apart', () => {
    expect(coordinateKey(41.9002, -87.65)).not.toBe(coordinateKey(41.9, -87.65))
  })
})

describe('representativeOf', () => {
  // The vendor is asked to order faces, so each face needs one location. The
  // middle door is the least wrong choice for a face that may be entered at
  // either end.
  it('stands a face up at the door nearest its centre', () => {
    const stops = [
      stop('101 W Elm St', 41.9, -87.65),
      stop('103 W Elm St', 41.901, -87.65),
      stop('105 W Elm St', 41.902, -87.65),
    ]
    const [face] = groupIntoBlockFaces(stops)

    expect(representativeOf(face!, stops)).toBe(1)
  })
})

describe('sequenceBlockFaces', () => {
  // The reported bug, as a regression: 3620 and 3630 are neighbours on the
  // even side and nothing may come between them.
  it('does not cross the street between two neighbours on one side', () => {
    const { addresses } = walkOrder(qaStops)

    const even = [
      addresses.indexOf('3620 NE 64th Ave'),
      addresses.indexOf('3630 NE 64th Ave'),
    ].sort((a, b) => a - b)
    expect(even[1]! - even[0]!).toBe(1)
    expect(addresses.indexOf('3629 NE 64th Ave')).not.toBe(1)
  })

  // The property that makes a list walkable, stated directly: a face is
  // finished before the next one starts.
  it('walks each face as one unbroken run', () => {
    const stops = [
      stop('101 W Elm St', 41.9, -87.65),
      stop('102 W Elm St', 41.9, -87.651),
      stop('103 W Elm St', 41.901, -87.65),
      stop('104 W Elm St', 41.901, -87.651),
      stop('105 W Elm St', 41.902, -87.65),
      stop('106 W Elm St', 41.902, -87.651),
    ]
    const { faces, sequenced } = walkOrder(stops)

    const faceOf = new Map<number, string>()
    faces.forEach((face) => {
      for (const index of face.stopIndexes) faceOf.set(index, face.key)
    })
    const runs = sequenced.stopIndexes
      .map((index) => faceOf.get(index))
      .filter((key, position, keys) => key !== keys[position - 1])
    expect(runs).toEqual([...new Set(runs)])
    expect(runs).toHaveLength(faces.length)
  })

  // Given the face order, the direction each face is walked in is chosen, not
  // alternated: entering at the far end costs a whole block face to walk back.
  it('enters each face at the end nearest the one before it', () => {
    const stops = [
      // Odd side, ascending north.
      stop('101 W Elm St', 41.9, -87.65),
      stop('103 W Elm St', 41.901, -87.65),
      stop('105 W Elm St', 41.902, -87.65),
      // Even side, across the street.
      stop('102 W Elm St', 41.9, -87.651),
      stop('104 W Elm St', 41.901, -87.651),
      stop('106 W Elm St', 41.902, -87.651),
    ]
    const { addresses } = walkOrder(stops)

    // Whichever end the walk starts from, the crossing happens between two
    // doors that face each other rather than between opposite corners.
    const crossing = addresses.indexOf('102 W Elm St') === 3 ? '102' : '106'
    expect(addresses[2]).toBe(
      crossing === '102' ? '101 W Elm St' : '105 W Elm St',
    )
    expect(addresses[3]).toBe(`${crossing} W Elm St`)
  })

  it('keeps the vendor face order', () => {
    const { addresses } = walkOrder(qaStops, { faceOrder: [1, 0] })

    expect(addresses[0]).toBe('3629 NE 64th Ave')
  })

  describe('legs', () => {
    const twoFaces = [
      stop('101 W Elm St', 41.9, -87.65),
      stop('103 W Elm St', 41.901, -87.65),
      stop('102 W Elm St', 41.9, -87.651),
    ]

    it('takes the vendor leg where the walk crosses into a new face', () => {
      const { sequenced } = walkOrder(twoFaces, {
        faceLegSeconds: [0, 420],
        faceLegMeters: [0, 900],
      })

      // Three stops, two faces: the third stop is the first of its face.
      expect(sequenced.legSeconds[2]).toBe(420)
      expect(sequenced.legMeters[2]).toBe(900)
    })

    // Along one side of one street the sidewalk is the straight line, so the
    // leg is computed here rather than bought.
    it('measures the legs inside a face itself', () => {
      const { sequenced } = walkOrder(twoFaces, {
        faceLegSeconds: [0, 420],
        faceLegMeters: [0, 900],
      })

      // 0.001 degrees of latitude is ~111m, inflated by the detour factor.
      expect(sequenced.legMeters[1]).toBeGreaterThan(130)
      expect(sequenced.legMeters[1]).toBeLessThan(160)
      expect(sequenced.legSeconds[1]).toBeGreaterThan(0)
    })

    // The per-leg minutes on the walk sheet should add up to the total printed
    // above them, which passing the vendor's own total through did not do.
    it('totals the legs it wrote', () => {
      const { sequenced } = walkOrder(twoFaces, {
        faceLegSeconds: [0, 420],
        faceLegMeters: [0, 900],
      })

      expect(sequenced.totalSeconds).toBe(
        sequenced.legSeconds.reduce((sum, value) => sum + value, 0),
      )
      expect(sequenced.totalMeters).toBe(
        sequenced.legMeters.reduce((sum, value) => sum + value, 0),
      )
    })

    // A closed tour owes the trip home, and it belongs to no door — exactly
    // how the vendor reports its own extra leg.
    it('adds the trip home to a loop total without giving it to a stop', () => {
      const open = walkOrder(twoFaces).sequenced
      const loop = walkOrder(twoFaces, { loop: true }).sequenced

      expect(loop.legMeters).toEqual(open.legMeters)
      expect(loop.totalMeters).toBeGreaterThan(open.totalMeters)
    })
  })

  it('handles a single door', () => {
    const { sequenced } = walkOrder([stop('101 W Elm St', 41.9, -87.65)])

    expect(sequenced.stopIndexes).toEqual([0])
    expect(sequenced.legSeconds).toEqual([0])
    expect(sequenced.totalSeconds).toBe(0)
  })
})
