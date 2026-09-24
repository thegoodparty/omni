import { describe, expect, it } from 'vitest'
import { GeoJsonPolygon, GeoJsonShape } from '@goodparty_org/contracts'
import {
  pointInPolygon,
  pointInShape,
  polygonBbox,
  shapeBbox,
} from './geo.util'

const square: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-87.66, 41.89],
      [-87.64, 41.89],
      [-87.64, 41.91],
      [-87.66, 41.91],
      [-87.66, 41.89],
    ],
  ],
}

const squareWithHole: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    ...square.coordinates,
    [
      [-87.655, 41.895],
      [-87.645, 41.895],
      [-87.645, 41.905],
      [-87.655, 41.905],
      [-87.655, 41.895],
    ],
  ],
}

describe('pointInPolygon', () => {
  it('accepts a point inside the outer ring', () => {
    expect(pointInPolygon(-87.65, 41.9, square)).toBe(true)
  })

  it('rejects a point outside the ring but inside the bbox corner', () => {
    expect(pointInPolygon(-87.67, 41.9, square)).toBe(false)
  })

  it('rejects a point inside a hole', () => {
    expect(pointInPolygon(-87.65, 41.9, squareWithHole)).toBe(false)
  })

  it('accepts a point between the hole and the outer ring', () => {
    expect(pointInPolygon(-87.657, 41.9, squareWithHole)).toBe(true)
  })
})

describe('polygonBbox', () => {
  it('bounds the outer ring', () => {
    expect(polygonBbox(square)).toEqual({
      minLat: 41.89,
      maxLat: 41.91,
      minLng: -87.66,
      maxLng: -87.64,
    })
  })
})

// Two squares sharing the band between -87.65 and -87.64. A person standing
// in that band is inside both parts, and is the case a flattened even-odd ray
// cast gets wrong: the crossings of the two outer rings cancel and the point
// reads as outside a boundary it is in the middle of.
const overlappingPair: GeoJsonShape = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-87.66, 41.89],
        [-87.64, 41.89],
        [-87.64, 41.91],
        [-87.66, 41.91],
        [-87.66, 41.89],
      ],
    ],
    [
      [
        [-87.65, 41.89],
        [-87.63, 41.89],
        [-87.63, 41.91],
        [-87.65, 41.91],
        [-87.65, 41.89],
      ],
    ],
  ],
}

const disjointPair: GeoJsonShape = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-87.66, 41.89],
        [-87.65, 41.89],
        [-87.65, 41.9],
        [-87.66, 41.9],
        [-87.66, 41.89],
      ],
    ],
    [
      [
        [-87.6, 41.95],
        [-87.59, 41.95],
        [-87.59, 41.96],
        [-87.6, 41.96],
        [-87.6, 41.95],
      ],
    ],
  ],
}

describe('pointInShape', () => {
  it('reads a legacy single Polygon as the one part it is', () => {
    expect(pointInShape(-87.65, 41.9, square)).toBe(true)
    expect(pointInShape(-87.7, 41.9, square)).toBe(false)
  })

  it('counts a point inside either part of a disjoint boundary', () => {
    expect(pointInShape(-87.655, 41.895, disjointPair)).toBe(true)
    expect(pointInShape(-87.595, 41.955, disjointPair)).toBe(true)
  })

  it('excludes a point in the gap between two parts', () => {
    expect(pointInShape(-87.63, 41.92, disjointPair)).toBe(false)
  })

  it('counts a point where parts overlap, rather than cancelling them', () => {
    expect(pointInShape(-87.645, 41.9, overlappingPair)).toBe(true)
  })

  it('still subtracts a hole within one part', () => {
    expect(pointInShape(-87.65, 41.9, squareWithHole)).toBe(false)
  })
})

describe('shapeBbox', () => {
  it('returns the only part box for a legacy Polygon', () => {
    expect(shapeBbox(square)).toEqual(polygonBbox(square))
  })

  it('unions the boxes of every part', () => {
    expect(shapeBbox(disjointPair)).toEqual({
      minLat: 41.89,
      maxLat: 41.96,
      minLng: -87.66,
      maxLng: -87.59,
    })
  })
})
