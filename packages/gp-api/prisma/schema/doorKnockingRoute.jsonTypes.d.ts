export {}

declare global {
  export namespace PrismaJson {
    // GeoJSON LineString/MultiLineString (RFC 7946): the road-following
    // walking path for the whole tour, [lng, lat] positions.
    export type RoutePathGeometry =
      | { type: 'LineString'; coordinates: [number, number][] }
      | { type: 'MultiLineString'; coordinates: [number, number][][] }
  }
}
