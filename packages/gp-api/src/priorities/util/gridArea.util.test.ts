import { describe, expect, it } from 'vitest'
import { GeoJsonShapeSchema, shapePolygons } from '@goodparty_org/contracts'
import { pointInShape } from '@/shared/util/geo.util'
import { gridAreaShape, MAX_AREA_PARTS, type GridCell } from './gridArea.util'

const SIZE = 0.004

const center = ({ row, col }: GridCell): [number, number] => [
  (col + 0.5) * SIZE,
  (row + 0.5) * SIZE,
]

const block = (rows: number, cols: number, row0 = 0, col0 = 0): GridCell[] =>
  Array.from({ length: rows * cols }, (_, index) => ({
    row: row0 + Math.floor(index / cols),
    col: col0 + (index % cols),
  }))

describe('gridAreaShape', () => {
  it('is null with no squares', () => {
    expect(gridAreaShape([], SIZE)).toBeNull()
  })

  it('outlines a block of squares as one rectangle', () => {
    const shape = gridAreaShape(block(2, 3, 9000, -20000), SIZE)
    expect(shape?.type).toBe('Polygon')
    expect(GeoJsonShapeSchema.safeParse(shape).success).toBe(true)
    const [outer] = shape ? (shapePolygons(shape)[0]?.coordinates ?? []) : []
    expect(outer).toHaveLength(5)
  })

  it('holds every square it was given and nothing between patches', () => {
    const cells = [...block(2, 2), ...block(1, 1, 10, 10)]
    const shape = gridAreaShape(cells, SIZE)
    expect(shape?.type).toBe('MultiPolygon')
    if (!shape) return
    for (const cell of cells) {
      const [lng, lat] = center(cell)
      expect(pointInShape(lng, lat, shape)).toBe(true)
    }
    const [lng, lat] = center({ row: 5, col: 5 })
    expect(pointInShape(lng, lat, shape)).toBe(false)
  })

  it('fills a pocket, since a drawn part is one ring', () => {
    const ring = block(3, 3).filter(({ row, col }) => !(row === 1 && col === 1))
    const shape = gridAreaShape(ring, SIZE)
    expect(shape?.type).toBe('Polygon')
    if (!shape) return
    expect(shapePolygons(shape)[0]?.coordinates).toHaveLength(1)
    const [lng, lat] = center({ row: 1, col: 1 })
    expect(pointInShape(lng, lat, shape)).toBe(true)
  })

  it('closes up scattered squares until the parts fit', () => {
    const scattered = Array.from({ length: 30 }, (_, index) => ({
      row: 0,
      col: index * 2,
    }))
    const shape = gridAreaShape(scattered, SIZE)
    if (!shape) throw new Error('expected a shape')
    expect(shapePolygons(shape).length).toBeLessThanOrEqual(MAX_AREA_PARTS)
    for (const cell of scattered) {
      const [lng, lat] = center(cell)
      expect(pointInShape(lng, lat, shape)).toBe(true)
    }
  })
})
