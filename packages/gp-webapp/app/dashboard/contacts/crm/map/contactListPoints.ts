import type { Person } from '../shared/contacts-types'

export interface ContactPoint {
  lng: number
  lat: number
  residents: Person[]
}

export interface ContactPoints {
  points: ContactPoint[]
  // People the map cannot draw. Carried rather than dropped: a list whose
  // coordinates are missing would otherwise render as a smaller map that
  // looks complete, and the caller is expected to say how many are absent.
  unmappable: number
}

const isBlank = (value: string | null | undefined): boolean =>
  value == null || value.trim() === ''

// Grouped by coordinate, NOT by address string. Every unit in an apartment
// building shares one lat/lon in the voter file, so grouping by address stacks
// a dozen coincident dots on one building and hides that it is one building
// holding a dozen people — which for a housing segment is the most interesting
// thing on the map.
//
// The key is the raw string pair as it arrives, so two records at one building
// group iff the file says they are at one point. Parsing to float first would
// make that a question about float equality instead.
export const toContactPoints = (people: Person[]): ContactPoints => {
  const byCoordinate = new Map<string, ContactPoint>()
  let unmappable = 0

  for (const person of people) {
    const rawLat = person.address?.latitude
    const rawLng = person.address?.longitude
    // Blank-checked before parsing, and deliberately not by truthiness.
    // `Number` maps null, '' and '   ' all to 0, which is finite, so a
    // missing coordinate that reaches the parse comes out as a real point on
    // the equator. Truthiness alone got '' right and '   ' wrong; testing
    // only for null gets both wrong. The trim is what separates "no value"
    // from the value zero.
    if (isBlank(rawLat) || isBlank(rawLng)) {
      unmappable += 1
      continue
    }
    // '0' survives the check above and lands here, which is the point: zero
    // is a coordinate, not an absence.
    const lat = Number(rawLat)
    const lng = Number(rawLng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      unmappable += 1
      continue
    }
    const key = `${rawLat},${rawLng}`
    const existing = byCoordinate.get(key)
    if (existing) {
      existing.residents.push(person)
      continue
    }
    byCoordinate.set(key, { lat, lng, residents: [person] })
  }

  return { points: [...byCoordinate.values()], unmappable }
}

export interface Bounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export const boundsOf = (points: ContactPoint[]): Bounds | null => {
  if (points.length === 0) return null
  const first = points[0]!
  return points.reduce<Bounds>(
    (acc, p) => ({
      minLng: Math.min(acc.minLng, p.lng),
      minLat: Math.min(acc.minLat, p.lat),
      maxLng: Math.max(acc.maxLng, p.lng),
      maxLat: Math.max(acc.maxLat, p.lat),
    }),
    {
      minLng: first.lng,
      minLat: first.lat,
      maxLng: first.lng,
      maxLat: first.lat,
    },
  )
}
