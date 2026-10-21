import { describe, expect, it } from 'vitest'
import { boundsOfPoints, CELL_DEGREES, toGridCells } from './respondentGrid'

describe('toGridCells', () => {
  it('counts neighbors into one square and keeps distant ones apart', () => {
    const cells = toGridCells([
      { lat: 35.5951, lng: -82.5511 },
      { lat: 35.5952, lng: -82.5512 },
      { lat: 35.65, lng: -82.6 },
    ])

    expect(cells.map((cell) => cell.count).sort()).toEqual([1, 2])
  })

  it('draws each square as a closed ring one cell wide', () => {
    const [cell] = toGridCells([{ lat: 35.5951, lng: -82.5511 }])
    const ring = cell?.polygon ?? []
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
    const lngs = ring.map(([lng]) => lng)
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(CELL_DEGREES, 9)
  })
})

describe('boundsOfPoints', () => {
  it('is null with nobody to frame', () => {
    expect(boundsOfPoints([])).toBeNull()
  })
})
