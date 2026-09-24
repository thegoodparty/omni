export {}

declare global {
  export namespace PrismaJson {
    // GeoJSON MultiPolygon (RFC 7946): a list boundary made of several
    // parts. Each part is its own ring array, exterior ring first.
    export type GeoJsonMultiPolygon = {
      type: 'MultiPolygon'
      coordinates: [number, number][][][]
    }

    // What `voter_file_filter.geo_poly` holds. The union is permanent, not a
    // migration window: rows written before a list could hold more than one
    // shape are valid `Polygon`s describing exactly what was drawn, and every
    // reader normalizes through `shapePolygons`.
    export type GeoJsonShape = GeoJsonPolygon | GeoJsonMultiPolygon
  }
}
