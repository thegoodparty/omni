import { describe, expect, it } from 'vitest'
import type { GeoJsonShape } from '@goodparty_org/contracts'
import {
  nextShapeColor,
  nextShapeName,
  shapesFromSaved,
  shapesToSave,
  type ListShape,
} from './listShapes'

const RING: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
]

const TWO_PARTS: GeoJsonShape = {
  type: 'MultiPolygon',
  coordinates: [
    [[...RING, RING[0]!]],
    [[...RING.map(([x, y]): [number, number] => [x + 5, y]), [5, 0]]],
  ],
}

describe('shapesFromSaved', () => {
  // A list saved before shapes could be named reopens the way the map drew
  // it then: numbered, in palette order.
  it('names and colours parts a legacy list never labelled', () => {
    expect(
      shapesFromSaved(TWO_PARTS, null).map(({ name, color }) => ({
        name,
        color,
      })),
    ).toEqual([
      { name: 'Shape 1', color: '#2563eb' },
      { name: 'Shape 2', color: '#16a34a' },
    ])
  })

  it('reads each part its own label by index', () => {
    const shapes = shapesFromSaved(TWO_PARTS, [
      { name: 'Downtown', color: '#db2777' },
      { name: 'Riverside', color: '#0d9488' },
    ])
    expect(shapes.map((shape) => shape.name)).toEqual(['Downtown', 'Riverside'])
    expect(shapes[1]?.ring[0]).toEqual([5, 0])
  })
})

describe('shapesToSave', () => {
  // An unfinished shape is dropped from BOTH arrays, or every label after it
  // would land on the wrong part.
  it('keeps the labels joined to the parts when a shape is unfinished', () => {
    const shapes: ListShape[] = [
      { name: 'Half drawn', color: '#2563eb', ring: [[0, 0]] },
      { name: 'Riverside', color: '#16a34a', ring: RING },
    ]
    expect(shapesToSave(shapes)).toEqual({
      geoPoly: { type: 'Polygon', coordinates: [[...RING, RING[0]]] },
      geoPolyLabels: [{ name: 'Riverside', color: '#16a34a' }],
    })
  })

  it('clears both when nothing is drawn', () => {
    expect(shapesToSave([])).toEqual({ geoPoly: null, geoPolyLabels: null })
  })
})

describe('next shape defaults', () => {
  const shape = (name: string, color: string): ListShape => ({
    name,
    color,
    ring: RING,
  })

  it('never hands a new shape a name that survived a delete', () => {
    expect(nextShapeName([shape('Shape 2', '#16a34a')])).toBe('Shape 1')
    expect(
      nextShapeName([shape('Shape 1', '#2563eb'), shape('Shape 2', '#16a34a')]),
    ).toBe('Shape 3')
  })

  it('takes the first colour no shape is using', () => {
    expect(nextShapeColor([shape('A', '#2563eb'), shape('B', '#d97706')])).toBe(
      '#16a34a',
    )
  })
})
