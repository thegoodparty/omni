import { describe, expect, it } from 'vitest'
import { GeoJsonPolygon } from '@goodparty_org/contracts'
import { pointInPolygon, polygonBbox } from './geo.util'

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
