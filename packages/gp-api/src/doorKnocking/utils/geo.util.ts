import { Bbox, GeoJsonPolygon } from '@goodparty_org/contracts'

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
