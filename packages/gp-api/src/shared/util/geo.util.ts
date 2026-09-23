import {
  Bbox,
  GeoJsonPolygon,
  GeoJsonShape,
  shapePolygons,
} from '@goodparty_org/contracts'

// TODO(geom-index): both helpers are the interim geo path. When people_db
// grows a geometry column + GiST index, people-api runs ST_Contains against
// the exact polygon and the bbox prefilter + this in-process ray-cast
// disappear.
export const polygonBbox = (polygon: GeoJsonPolygon): Bbox => {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  const outerRing = polygon.coordinates[0] ?? []
  for (const [lng, lat] of outerRing) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return { minLat, maxLat, minLng, maxLng }
}

// Even-odd ray cast over every ring, so holes subtract: a point inside the
// outer ring AND inside a hole crosses both boundaries an odd+odd = even
// total number of times.
export const pointInPolygon = (
  lng: number,
  lat: number,
  polygon: GeoJsonPolygon,
): boolean => {
  let inside = false
  for (const ring of polygon.coordinates) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] ?? [0, 0]
      const [xj, yj] = ring[j] ?? [0, 0]
      const crosses =
        yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (crosses) inside = !inside
    }
  }
  return inside
}

// The box around every part of a boundary. The union of the parts' boxes, so
// a shape whose parts sit at opposite ends of a district yields one rectangle
// covering both — see `resolveGeoMemberIds`, which deliberately scans the
// parts separately rather than handing this to people-db.
export const shapeBbox = (shape: GeoJsonShape): Bbox => {
  const boxes = shapePolygons(shape).map(polygonBbox)
  return {
    minLat: Math.min(...boxes.map(({ minLat }) => minLat)),
    maxLat: Math.max(...boxes.map(({ maxLat }) => maxLat)),
    minLng: Math.min(...boxes.map(({ minLng }) => minLng)),
    maxLng: Math.max(...boxes.map(({ maxLng }) => maxLng)),
  }
}

// Whether a point falls inside ANY part of a boundary.
//
// Per-part, then OR'd — and that is the whole point of this function rather
// than a widened `pointInPolygon`. The ray cast is EVEN-ODD, which is what
// makes a hole subtract from the polygon around it. Run over the rings of two
// SEPARATE parts at once it would subtract them from each other too, so a
// person standing where two drawn shapes overlap would be counted out of
// both — silently, and only in the overlap.
export const pointInShape = (
  lng: number,
  lat: number,
  shape: GeoJsonShape,
): boolean =>
  shapePolygons(shape).some((polygon) => pointInPolygon(lng, lat, polygon))
