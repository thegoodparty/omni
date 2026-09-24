import { describe, expect, it } from 'vitest'
import {
  isPointInAnyRing,
  isPointInRing,
  ringFromGeoJsonPolygon,
  ringToGeoJsonPolygon,
  ringsFromGeoJsonShape,
  ringsToGeoJsonShape,
  type PolygonRing,
} from './ringGeometry'

// A square around the block, counter-clockwise.
const SQUARE: PolygonRing = [
  [-87.66, 41.92],
  [-87.64, 41.92],
  [-87.64, 41.93],
  [-87.66, 41.93],
]

describe('isPointInRing', () => {
  it('takes a point inside and refuses one outside', () => {
    expect(isPointInRing(-87.65, 41.925, SQUARE)).toBe(true)
    expect(isPointInRing(-87.63, 41.925, SQUARE)).toBe(false)
    expect(isPointInRing(-87.65, 41.94, SQUARE)).toBe(false)
  })

  // Two points are a line, and a line contains nobody — the map draws no
  // polygon before the third corner and neither may the count.
  it('contains nothing under three points', () => {
    expect(isPointInRing(-87.65, 41.925, SQUARE.slice(0, 2))).toBe(false)
    expect(isPointInRing(-87.65, 41.925, [])).toBe(false)
  })

  it('handles a concave ring rather than its bounding box', () => {
    const chevron: PolygonRing = [
      [0, 0],
      [4, 0],
      [4, 4],
      [2, 1],
      [0, 4],
    ]
    expect(isPointInRing(2, 0.5, chevron)).toBe(true)
    // Inside the bounding box, outside the notch.
    expect(isPointInRing(2, 3, chevron)).toBe(false)
  })
})

describe('ringToGeoJsonPolygon', () => {
  it('closes the ring by repeating the first position', () => {
    expect(ringToGeoJsonPolygon(SQUARE)).toEqual({
      type: 'Polygon',
      coordinates: [[...SQUARE, SQUARE[0]]],
    })
  })

  it('is null under three points, so no degenerate shape reaches the wire', () => {
    expect(ringToGeoJsonPolygon([])).toBeNull()
    expect(ringToGeoJsonPolygon(SQUARE.slice(0, 2))).toBeNull()
  })
})

describe('ringFromGeoJsonPolygon', () => {
  it('reopens a saved boundary by dropping the closing duplicate', () => {
    expect(ringFromGeoJsonPolygon(ringToGeoJsonPolygon(SQUARE))).toEqual(SQUARE)
  })

  it('reads a list with no boundary as no ring', () => {
    expect(ringFromGeoJsonPolygon(null)).toEqual([])
    expect(ringFromGeoJsonPolygon(undefined)).toEqual([])
  })
})

// Overlaps SQUARE across the band between -87.65 and -87.64.
const OVERLAPPING: PolygonRing = [
  [-87.65, 41.92],
  [-87.63, 41.92],
  [-87.63, 41.93],
  [-87.65, 41.93],
]

// Nowhere near either of the other two.
const FAR: PolygonRing = [
  [-87.5, 41.8],
  [-87.49, 41.8],
  [-87.49, 41.81],
  [-87.5, 41.81],
]

describe('isPointInAnyRing', () => {
  it('takes a point inside either part', () => {
    expect(isPointInAnyRing(-87.655, 41.925, [SQUARE, FAR])).toBe(true)
    expect(isPointInAnyRing(-87.495, 41.805, [SQUARE, FAR])).toBe(true)
  })

  it('refuses a point in the gap between parts', () => {
    expect(isPointInAnyRing(-87.6, 41.87, [SQUARE, FAR])).toBe(false)
  })

  // The bug a single even-odd cast over both rings would introduce: the two
  // outer rings cancel across the band they share, and someone standing in
  // the middle of the boundary reads as outside it.
  it('counts a point where two parts overlap', () => {
    expect(isPointInAnyRing(-87.645, 41.925, [SQUARE, OVERLAPPING])).toBe(true)
  })
})

describe('ringsToGeoJsonShape', () => {
  it('keeps one part a plain Polygon, as every list saved before held', () => {
    const shape = ringsToGeoJsonShape([SQUARE])
    expect(shape).toEqual(ringToGeoJsonPolygon(SQUARE))
  })

  it('serialises several parts as a MultiPolygon', () => {
    const shape = ringsToGeoJsonShape([SQUARE, FAR])
    expect(shape?.type).toBe('MultiPolygon')
    expect(shape).toEqual({
      type: 'MultiPolygon',
      coordinates: [
        ringToGeoJsonPolygon(SQUARE)!.coordinates,
        ringToGeoJsonPolygon(FAR)!.coordinates,
      ],
    })
  })

  // A part under three points is one the holder is still placing corners
  // on. It must not reach the wire as a degenerate polygon, and it must not
  // take the finished parts down with it.
  it('drops a part still being drawn and keeps the rest', () => {
    expect(ringsToGeoJsonShape([SQUARE, [[-87.6, 41.9]]])).toEqual(
      ringToGeoJsonPolygon(SQUARE),
    )
  })

  it('is null when nothing is drawn, so a save clears the boundary', () => {
    expect(ringsToGeoJsonShape([[]])).toBeNull()
    expect(ringsToGeoJsonShape([])).toBeNull()
  })
})

describe('ringsFromGeoJsonShape', () => {
  // A list saved before a boundary could have parts reopens as the one
  // shape it was drawn as, not as an empty surface.
  it('reads a legacy Polygon back as a single part', () => {
    expect(ringsFromGeoJsonShape(ringToGeoJsonPolygon(SQUARE))).toEqual([
      SQUARE,
    ])
  })

  it('round-trips a multi-part boundary', () => {
    const shape = ringsToGeoJsonShape([SQUARE, FAR])
    expect(ringsFromGeoJsonShape(shape)).toEqual([SQUARE, FAR])
  })

  it('reads an absent boundary as no parts', () => {
    expect(ringsFromGeoJsonShape(null)).toEqual([])
    expect(ringsFromGeoJsonShape(undefined)).toEqual([])
  })
})
