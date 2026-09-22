import { describe, expect, it } from 'vitest'
import {
  isPointInRing,
  ringFromGeoJsonPolygon,
  ringToGeoJsonPolygon,
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
