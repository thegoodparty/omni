import type { GeoJsonShape } from '@goodparty_org/contracts'

// A grid square by its row (latitude) and column (longitude) index: the
// square spans row * size to (row + 1) * size degrees.
export interface GridCell {
  row: number
  col: number
}

// Every part of a boundary is its own warehouse scan when the list is
// saved, so an area of many scattered squares is closed up until it has
// at most this many parts.
export const MAX_AREA_PARTS = 12
const MAX_CLOSINGS = 3

type Vertex = [number, number] // [col, row]
interface Edge {
  from: Vertex
  to: Vertex
}

const keyOf = (row: number, col: number): string => `${row}:${col}`
const vertexKey = ([x, y]: Vertex): string => `${x}:${y}`

const parse = (key: string): GridCell => {
  const [row = 0, col = 0] = key.split(':').map(Number)
  return { row, col }
}

const components = (cells: Set<string>): GridCell[][] => {
  const seen = new Set<string>()
  const found: GridCell[][] = []
  for (const start of cells) {
    if (seen.has(start)) continue
    seen.add(start)
    const queue = [parse(start)]
    const component: GridCell[] = []
    while (queue.length > 0) {
      const cell = queue.pop()
      if (!cell) break
      component.push(cell)
      const neighbors: Array<[number, number]> = [
        [cell.row + 1, cell.col],
        [cell.row - 1, cell.col],
        [cell.row, cell.col + 1],
        [cell.row, cell.col - 1],
      ]
      for (const [row, col] of neighbors) {
        const key = keyOf(row, col)
        if (cells.has(key) && !seen.has(key)) {
          seen.add(key)
          queue.push({ row, col })
        }
      }
    }
    found.push(component)
  }
  return found
}

// Grows the area by one square in every direction, joining parts that sit
// a street or two apart.
const close = (cells: Set<string>): Set<string> => {
  const grown = new Set(cells)
  for (const key of cells) {
    const { row, col } = parse(key)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) grown.add(keyOf(row + dr, col + dc))
    }
  }
  return grown
}

// Each square's sides run counter-clockwise; a side two squares share runs
// both ways and cancels, leaving only the area's outline.
const outlineEdges = (component: GridCell[]): Edge[] => {
  const edges = new Map<string, Edge>()
  for (const { row, col } of component) {
    const corners: Vertex[] = [
      [col, row],
      [col + 1, row],
      [col + 1, row + 1],
      [col, row + 1],
    ]
    corners.forEach((from, index) => {
      const to = corners[(index + 1) % 4] ?? from
      const reverse = `${vertexKey(to)}>${vertexKey(from)}`
      if (edges.has(reverse)) edges.delete(reverse)
      else edges.set(`${vertexKey(from)}>${vertexKey(to)}`, { from, to })
    })
  }
  return [...edges.values()]
}

// Left, then straight, then right: at a corner two squares touch only at,
// the left turn keeps each ring around its own squares.
const turnRank = (incoming: Vertex, outgoing: Vertex): number => {
  const cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0]
  if (cross > 0) return 0
  if (cross === 0) return 1
  return 2
}

const rings = (edges: Edge[]): Vertex[][] => {
  const outgoing = new Map<string, Edge[]>()
  for (const edge of edges) {
    const key = vertexKey(edge.from)
    outgoing.set(key, [...(outgoing.get(key) ?? []), edge])
  }
  const used = new Set<Edge>()
  const found: Vertex[][] = []
  for (const start of edges) {
    if (used.has(start)) continue
    const ring: Vertex[] = [start.from]
    let edge = start
    while (!used.has(edge)) {
      used.add(edge)
      ring.push(edge.to)
      const direction: Vertex = [
        edge.to[0] - edge.from[0],
        edge.to[1] - edge.from[1],
      ]
      const next = (outgoing.get(vertexKey(edge.to)) ?? [])
        .filter((candidate) => !used.has(candidate))
        .sort(
          (a, b) =>
            turnRank(direction, [a.to[0] - a.from[0], a.to[1] - a.from[1]]) -
            turnRank(direction, [b.to[0] - b.from[0], b.to[1] - b.from[1]]),
        )[0]
      if (!next) break
      edge = next
    }
    found.push(ring)
  }
  return found
}

// Drops the corners a straight side passes through.
const simplify = (ring: Vertex[]): Vertex[] => {
  const open = ring.slice(0, -1)
  const kept = open.filter((point, index) => {
    const prev = open[(index - 1 + open.length) % open.length] ?? point
    const next = open[(index + 1) % open.length] ?? point
    const cross =
      (point[0] - prev[0]) * (next[1] - point[1]) -
      (point[1] - prev[1]) * (next[0] - point[0])
    return cross !== 0
  })
  const first = kept[0]
  return first ? [...kept, first] : []
}

const signedArea = (ring: Vertex[]): number =>
  ring.reduce((sum, [x, y], index) => {
    const [nx, ny] = ring[(index + 1) % ring.length] ?? [x, y]
    return sum + x * ny - nx * y
  }, 0) / 2

const toDegrees = (value: number, size: number): number =>
  Math.round(value * size * 1e6) / 1e6

// The outline of a set of grid squares as a boundary any list can carry:
// one single-ring part per patch, the way a holder draws one, so the list's
// map can show and edit it. A pocket inside a patch is filled in, since a
// drawn part has no holes. Null for no squares.
export const gridAreaShape = (
  cells: GridCell[],
  cellDegrees: number,
): GeoJsonShape | null => {
  let area = new Set(cells.map(({ row, col }) => keyOf(row, col)))
  if (area.size === 0) return null
  let patches = components(area)
  for (let pass = 0; pass < MAX_CLOSINGS; pass++) {
    if (patches.length <= MAX_AREA_PARTS) break
    area = close(area)
    patches = components(area)
  }

  // Outer rings run counter-clockwise; a hole's ring runs the other way.
  const outers = patches
    .flatMap((patch) => rings(outlineEdges(patch)).map(simplify))
    .filter((ring) => ring.length >= 4 && signedArea(ring) > 0)
    .sort((a, b) => signedArea(b) - signedArea(a))
    .slice(0, MAX_AREA_PARTS)
  const polygons = outers.map((ring) => [
    ring.map(([x, y]): [number, number] => [
      toDegrees(x, cellDegrees),
      toDegrees(y, cellDegrees),
    ]),
  ])
  const [only] = polygons
  if (polygons.length === 1 && only) {
    return { type: 'Polygon', coordinates: only }
  }
  return { type: 'MultiPolygon', coordinates: polygons }
}

// What each part is called on the list's map, where a holder's own shapes
// are "Shape 1", "Shape 2". Names must differ, so several parts are numbered.
const UNREACHED_AREA_NAME = 'Not reached yet'
const UNREACHED_AREA_COLOR = '#d97706'

export const unreachedAreaLabels = (
  parts: number,
): Array<{ name: string; color: string }> =>
  Array.from({ length: parts }, (_, index) => ({
    name:
      parts === 1 ? UNREACHED_AREA_NAME : `${UNREACHED_AREA_NAME} ${index + 1}`,
    color: UNREACHED_AREA_COLOR,
  }))
