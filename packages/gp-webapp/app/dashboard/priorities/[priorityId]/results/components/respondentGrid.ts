import { DISTRICT_GRID_CELL_DEGREES } from '@goodparty_org/contracts'

// The same squares gp-api draws a district's unreached area from.
export const CELL_DEGREES = DISTRICT_GRID_CELL_DEGREES

export interface GridCell {
  polygon: [number, number][]
  count: number
}

// Bins respondents into fixed squares. Fixed rather than zoom-dependent so
// the squares are the same on every screen and a reload never redraws them.
export const toGridCells = (
  points: { lat: number; lng: number }[],
): GridCell[] => {
  const cells = new Map<string, { row: number; col: number; count: number }>()
  for (const { lat, lng } of points) {
    const row = Math.floor(lat / CELL_DEGREES)
    const col = Math.floor(lng / CELL_DEGREES)
    const key = `${row}:${col}`
    const cell = cells.get(key)
    if (cell) cell.count += 1
    else cells.set(key, { row, col, count: 1 })
  }
  return [...cells.values()].map(({ row, col, count }) => {
    const south = row * CELL_DEGREES
    const west = col * CELL_DEGREES
    const north = south + CELL_DEGREES
    const east = west + CELL_DEGREES
    return {
      count,
      polygon: [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    }
  })
}

export const boundsOfPoints = (
  points: { lat: number; lng: number }[],
): [[number, number], [number, number]] | null => {
  if (points.length === 0) return null
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const { lat, lng } of points) {
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  }
  return [
    [minLng, minLat],
    [maxLng + CELL_DEGREES, maxLat + CELL_DEGREES],
  ]
}
