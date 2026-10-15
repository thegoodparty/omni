import { describe, expect, it } from 'vitest'
import { parseWalkableAreaParam, walkableAreaParam } from './walkableAreaParam'

const box = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-97.75, 30.25],
      [-97.74, 30.25],
      [-97.74, 30.26],
      [-97.75, 30.26],
      [-97.75, 30.25],
    ] as [number, number][],
  ],
}

describe('walkableAreaParam', () => {
  it('writes the area as its bounding box', () => {
    expect(walkableAreaParam(box)).toBe('-97.75,30.25,-97.74,30.26')
  })

  it('reads the box back as an open ring the canvas can load', () => {
    const param = walkableAreaParam(box) ?? undefined
    expect(parseWalkableAreaParam(param)).toEqual([
      [-97.75, 30.25],
      [-97.74, 30.25],
      [-97.74, 30.26],
      [-97.75, 30.26],
    ])
  })

  it.each([
    undefined,
    '',
    '1,2,3',
    'a,b,c,d',
    '-97.74,30.25,-97.75,30.26',
    '-97.75,30.26,-97.74,30.25',
    '-190,30.25,-97.74,30.26',
    '-97.75,30.25,-97.74,95',
    '-97.75,,-97.74,30.26',
  ])('drops %s', (value) => {
    expect(parseWalkableAreaParam(value)).toBeUndefined()
  })
})
