import type { GeoJsonPolygon } from '@goodparty_org/contracts'
import type { PolygonRing } from './VoterMapCanvas'

// A walkable area handed to the create flow on `?area=`, as its bounding box
// `west,south,east,north`. The civic panel plan's door step draws its
// households and a padded box around them; the box becomes the turf's
// boundary on the draw step, so the official does not draw it by hand.

const round = (value: number) => Number(value.toFixed(6))

export const walkableAreaParam = (area: GeoJsonPolygon): string | null => {
  const ring = area.coordinates[0] ?? []
  if (ring.length === 0) return null
  const lngs = ring.map(([lng]) => lng)
  const lats = ring.map(([, lat]) => lat)
  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ]
    .map(round)
    .join(',')
}

// The box as an open ring (the canvas's shape, first corner not repeated),
// or undefined for anything that is not four finite numbers making a box
// on the globe. A bad value is dropped, the way a bad `?listId=` is.
export const parseWalkableAreaParam = (
  value: string | undefined,
): PolygonRing | undefined => {
  if (!value) return undefined
  const parts = value.split(',')
  if (parts.length !== 4) return undefined
  const numbers = parts.map((part) => (part.trim() === '' ? NaN : +part))
  const [west, south, east, north] = numbers
  if (
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined ||
    numbers.some((n) => !Number.isFinite(n)) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    return undefined
  }
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ]
}
