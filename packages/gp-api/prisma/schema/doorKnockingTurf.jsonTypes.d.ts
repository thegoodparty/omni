export {}

declare global {
  export namespace PrismaJson {
    // GeoJSON Polygon (RFC 7946): the turf boundary drawn by the user.
    // Coordinates are [lng, lat] rings; the first ring is the exterior.
    export type GeoJsonPolygon = {
      type: 'Polygon'
      coordinates: [number, number][][]
    }
  }
}
