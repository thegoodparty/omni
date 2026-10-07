import { z } from 'zod'
import {
  GeoJsonPolygonSchema,
  type GeoJsonPolygon,
} from '../doorKnocking/DoorKnockingTurf.schema'

// A boundary made of several disjoint (or overlapping) parts — what a list's
// `geoPoly` becomes once the holder can draw more than one shape.
//
// `Polygon`'s own `coordinates` array is rings of ONE shape: the first is the
// outer boundary and the rest are holes. That is why a second shape cannot be
// expressed by appending to it, and why this is a separate GeoJSON type.
export const GeoJsonMultiPolygonSchema = z
  .object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(GeoJsonPolygonSchema.shape.coordinates).min(1),
  })
  .strict()

export type GeoJsonMultiPolygon = z.infer<typeof GeoJsonMultiPolygonSchema>

// What every geo-filter surface accepts and stores from now on.
//
// The union is permanent, not a migration window. `voter_file_filter.geo_poly`
// is a JSON column holding rows written before multi-shape existed, and those
// rows are valid `Polygon`s that describe exactly what their holder drew —
// rewriting them would be a data migration that buys nothing, because every
// reader normalizes through `shapePolygons` below.
//
// Door knocking's turf `geoPoly` is deliberately NOT this type: a walk
// boundary is one shape by nature, and widening it would let a route be
// bought for a turf whose parts are miles apart.
export const GeoJsonShapeSchema = z.discriminatedUnion('type', [
  GeoJsonPolygonSchema,
  GeoJsonMultiPolygonSchema,
])

export type GeoJsonShape = z.infer<typeof GeoJsonShapeSchema>

// Every part of a shape, as plain polygons. The one place the legacy
// single-`Polygon` row and the multi-part row stop being different things,
// so no caller downstream has to branch on `type`.
export const shapePolygons = (shape: GeoJsonShape): GeoJsonPolygon[] =>
  shape.type === 'Polygon'
    ? [shape]
    : shape.coordinates.map((coordinates) => ({
        type: 'Polygon' as const,
        coordinates,
      }))

// How many parts a boundary has — the number a surface prints as "2 shapes".
export const shapePartCount = (shape: GeoJsonShape): number =>
  shape.type === 'Polygon' ? 1 : shape.coordinates.length

// What the holder called each part of a list's boundary, and the colour they
// drew it in. A GeoJSON `MultiPolygon` has nowhere to carry either, so this
// rides beside `geoPoly` as its own array, one entry per part in
// `shapePolygons` order. The index IS the join, which is why a write that
// changes the shape without restating its labels clears them rather than
// leaving names attached to parts that moved.
export const MAX_GEO_SHAPE_NAME_LENGTH = 120

export const GeoShapeLabelSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_GEO_SHAPE_NAME_LENGTH),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict()

export type GeoShapeLabel = z.infer<typeof GeoShapeLabelSchema>

export const GeoShapeLabelsSchema = z.array(GeoShapeLabelSchema).min(1)

export type GeoShapeLabels = z.infer<typeof GeoShapeLabelsSchema>
