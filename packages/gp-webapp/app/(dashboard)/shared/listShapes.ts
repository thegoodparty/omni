import type {
  GeoJsonShape,
  GeoShapeLabel,
  GeoShapeLabels,
} from '@goodparty_org/contracts'
import { TURF_COLORS } from 'app/(dashboard)/door-knocking/native/turfQueries'
import {
  ringsFromGeoJsonShape,
  ringsToGeoJsonShape,
  type PolygonRing,
} from './ringGeometry'

// One part of a list's boundary as the drawing surface holds it: the ring
// plus what the holder called it and the colour they drew it in. A part
// still being cut can have fewer than three corners.
export interface ListShape extends GeoShapeLabel {
  ring: PolygonRing
}

// The palette door knocking cuts turfs in, so a shape on a list and a turf
// on a walk read as the same kind of thing.
export const SHAPE_COLORS = TURF_COLORS

export const defaultShapeName = (index: number): string => `Shape ${index + 1}`

// The lowest "Shape N" no shape is called yet. Counting from the list's
// length would hand a new shape the name of one that survived a delete, and
// Save refuses two shapes with one name.
export const nextShapeName = (shapes: ListShape[]): string => {
  const taken = new Set(shapes.map((shape) => shape.name.trim().toLowerCase()))
  let index = 0
  while (taken.has(defaultShapeName(index).toLowerCase())) index += 1
  return defaultShapeName(index)
}

const defaultShapeColor = (index: number): string =>
  SHAPE_COLORS[index % SHAPE_COLORS.length]!

// The first palette colour no shape is using yet, so a second shape never
// comes out in the first one's colour. Past seven it cycles.
export const nextShapeColor = (shapes: ListShape[]): string =>
  SHAPE_COLORS.find((color) => !shapes.some((s) => s.color === color)) ??
  defaultShapeColor(shapes.length)

export const isDrawnShape = (shape: ListShape): boolean =>
  shape.ring.length >= 3

// A saved list's boundary as shapes. Labels are joined to parts by index;
// a list saved before shapes could be named has none, and a part with no
// label reads as "Shape N" in palette order, which is what the map drew it
// as before names existed.
export const shapesFromSaved = (
  geoPoly: GeoJsonShape | null | undefined,
  labels: GeoShapeLabels | null | undefined,
): ListShape[] =>
  ringsFromGeoJsonShape(geoPoly).map((ring, index) => ({
    name: labels?.[index]?.name ?? defaultShapeName(index),
    color: labels?.[index]?.color ?? defaultShapeColor(index),
    ring,
  }))

// The write. Only finished shapes are saved, and the labels are filtered by
// the same test so the two arrays stay joined by index.
export const shapesToSave = (
  shapes: ListShape[],
): { geoPoly: GeoJsonShape | null; geoPolyLabels: GeoShapeLabels | null } => {
  const drawn = shapes.filter(isDrawnShape)
  return drawn.length === 0
    ? { geoPoly: null, geoPolyLabels: null }
    : {
        geoPoly: ringsToGeoJsonShape(drawn.map((shape) => shape.ring)),
        geoPolyLabels: drawn.map(({ name, color }) => ({ name, color })),
      }
}
