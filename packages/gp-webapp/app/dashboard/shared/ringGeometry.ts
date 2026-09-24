import {
  shapePolygons,
  type GeoJsonPolygon,
  type GeoJsonShape,
} from '@goodparty_org/contracts'

// A boundary the user drew, as an OPEN ring: the closing duplicate the
// GeoJSON spec wants is added only when one is serialised. Two surfaces draw
// one now — door knocking's turf canvas and the constituent list map — so the
// shape and the maths that places a tap in it live here rather than in either
// map.
export type PolygonRing = Array<[number, number]>

// Shortest distance from `point` to the segment a-b. Longitude is scaled by
// cos(latitude) first because a degree of longitude is only ~0.75 of a degree
// of latitude at US latitudes — compared in raw degrees, a tall narrow ring's
// long sides read as closer than they are and the wrong edge wins.
const distanceToSegment = (
  point: [number, number],
  a: [number, number],
  b: [number, number],
  lngScale: number,
): number => {
  const px = point[0] * lngScale
  const ax = a[0] * lngScale
  const dx = b[0] * lngScale - ax
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const projected =
    lengthSq === 0 ? 0 : ((px - ax) * dx + (point[1] - a[1]) * dy) / lengthSq
  const t = Math.max(0, Math.min(1, projected))
  return Math.hypot(px - (ax + t * dx), point[1] - (a[1] + t * dy))
}

// Where a tap belongs in the ring being drawn. Under three points there are no
// edges yet, so it appends; from three the ring is read as closed and the point
// splices into whichever edge it is nearest. Appending unconditionally meant a
// tap between two existing vertices jumped the boundary across the shape and
// back, leaving a criss-crossed, self-intersecting outline.
export const ringInsertIndex = (
  ring: PolygonRing,
  point: [number, number],
): number => {
  if (ring.length < 3) return ring.length
  const lngScale = Math.cos((point[1] * Math.PI) / 180)
  let bestIndex = ring.length
  let bestDistance = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) continue
    const distance = distanceToSegment(point, a, b, lngScale)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i + 1
    }
  }
  return bestIndex
}

// Even-odd ray cast, the same rule gp-api's polygon preview applies on its
// side, so the number the map shows while a shape is being dragged and the
// number the server settles on afterwards are answers to the same question.
// A point exactly on an edge is not defined either way and is not worth
// defining: at the density a street is drawn at, one vertex either way is
// below the resolution of the gesture.
export const isPointInRing = (
  lng: number,
  lat: number,
  ring: PolygonRing,
): boolean => {
  // No guard for a ring under three points: its edges are one line walked
  // in both directions, so every crossing is counted twice and the parity
  // comes back false on its own.
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    const intersects =
      a[1] > lat !== b[1] > lat &&
      lng < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]
    if (intersects) inside = !inside
  }
  return inside
}

// The wire shape. GeoJSON wants a closed ring of at least four positions, so
// the first point is repeated at the end; under three drawn points there is
// no polygon to send and this returns null rather than a degenerate one.
export const ringToGeoJsonPolygon = (
  ring: PolygonRing,
): GeoJsonPolygon | null => {
  if (ring.length < 3) return null
  const first = ring[0]!
  return {
    type: 'Polygon',
    coordinates: [
      [...ring.map((point): [number, number] => [...point]), first],
    ],
  }
}

// The inverse, for a boundary read back off a saved list. Only the outer ring
// is read: the schema treats every ring after the first as a hole, and nothing
// in this product draws one.
export const ringFromGeoJsonPolygon = (
  polygon: GeoJsonPolygon | null | undefined,
): PolygonRing => {
  const outer = polygon?.coordinates?.[0]
  if (!outer || outer.length < 4) return []
  return outer.slice(0, -1).map((position) => [position[0], position[1]])
}

// A boundary with several parts, as the drawing surface holds it: one open
// ring per part, in the order they were drawn. A part still being cut can
// have fewer than three points, so this is not a list of finished polygons.
export type PolygonRings = PolygonRing[]

// Whether a point falls inside ANY part.
//
// Per-ring, then OR'd, mirroring gp-api's `pointInShape` — and for the same
// reason. `isPointInRing` is an even-odd cast, so running one cast over the
// concatenation of two parts would make their overlap subtract instead of
// add, and a person standing where two drawn shapes meet would be counted
// out of both. The two implementations have to agree, because this is the
// number shown while dragging and that one is the number saved.
export const isPointInAnyRing = (
  lng: number,
  lat: number,
  rings: PolygonRings,
): boolean => rings.some((ring) => isPointInRing(lng, lat, ring))

// Only the parts with a real shape. A part under three points is one the
// holder is still placing corners on, and it neither counts nor saves.
export const drawnRings = (rings: PolygonRings): PolygonRings =>
  rings.filter((ring) => ring.length >= 3)

// The wire shape for a boundary of any number of parts.
//
// One part still serialises as a plain `Polygon`, not a single-part
// `MultiPolygon`: it is what every list saved before multi-shape holds, and
// keeping new single-part saves identical to those means the stored column
// has one representation per boundary rather than two.
export const ringsToGeoJsonShape = (
  rings: PolygonRings,
): GeoJsonShape | null => {
  const polygons = drawnRings(rings)
    .map(ringToGeoJsonPolygon)
    .filter((polygon): polygon is GeoJsonPolygon => polygon !== null)
  if (polygons.length === 0) return null
  if (polygons.length === 1) return polygons[0]!
  return {
    type: 'MultiPolygon',
    coordinates: polygons.map((polygon) => polygon.coordinates),
  }
}

// The inverse, for a boundary read back off a saved list. A legacy `Polygon`
// row comes back as one part, so a list saved before multi-shape reopens as
// exactly the shape it was drawn as.
export const ringsFromGeoJsonShape = (
  shape: GeoJsonShape | null | undefined,
): PolygonRings => {
  if (!shape) return []
  return shapePolygons(shape)
    .map(ringFromGeoJsonPolygon)
    .filter((ring) => ring.length > 0)
}
