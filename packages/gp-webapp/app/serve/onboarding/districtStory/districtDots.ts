export const VIEW_WIDTH = 100
export const VIEW_HEIGHT = 93

export const TARGET_DOTS = 640
// Illustrative: the story sizes it to the answers a district needs.
export const SAMPLE_SIZE = 100
const LOUD_SIZE = 12
const JOINED_SIZE = 38
const MIN_REAL_DOTS = 100
const PADDING = 6
const SEED = 20261015

export type DistrictMapMode = 'all' | 'dim' | 'sample' | 'grow'

export interface DistrictDot {
  x: number
  y: number
  // 0..1, which wave of the intro this dot appears in.
  wave: number
  loud: boolean
  sample: boolean
  // Order within the sample, so the stagger reads as one dot after another.
  sampleOrder: number
  // Position in the fill-in order on the grow step, or -1.
  joinedOrder: number
}

// Where the basemap looks so it lines up with the dots: the middle of the
// view, and how wide the whole Web Mercator world is in view units.
export interface DistrictCamera {
  center: LatLng
  worldUnits: number
}

export interface DistrictDots {
  dots: DistrictDot[]
  // The stand-in's shape. Null on a real district: there is no boundary
  // geometry, so the streets show where it is instead.
  outline: string | null
  // Null on the stand-in, which has no place to show tiles of.
  camera: DistrictCamera | null
  // True when the map is a stand-in, not the official's district.
  abstract: boolean
  center: { x: number; y: number }
}

export interface LatLng {
  lat: number
  lng: number
}

const seededRandom = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffle = <T>(items: T[], rand: () => number): T[] => {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const swap = out[i] as T
    out[i] = out[j] as T
    out[j] = swap
  }
  return out
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0

const toPath = (points: { x: number; y: number }[]): string =>
  points.length < 3
    ? ''
    : `M${points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L')} Z`

// The illustrative picks: a loud cluster nearest the middle, ~100 spread out
// by a greedy minimum-distance pick, and a subset of those that "join".
const assignRoles = (
  positions: { x: number; y: number }[],
  rand: () => number,
  center: { x: number; y: number },
  sampleSize: number,
): DistrictDot[] => {
  const byChance = shuffle(
    positions.map((_, index) => index),
    rand,
  )
  const sample: number[] = []
  const picked = new Set<number>()
  for (const gap of [7, 6, 5, 4, 3, 0]) {
    for (const index of byChance) {
      if (sample.length >= sampleSize) break
      if (picked.has(index)) continue
      const p = positions[index]!
      const clear = sample.every((other) => {
        const q = positions[other]!
        return Math.hypot(q.x - p.x, q.y - p.y) >= gap
      })
      if (clear) {
        sample.push(index)
        picked.add(index)
      }
    }
    if (sample.length >= sampleSize) break
  }

  const loud = new Set(
    positions
      .map((p, index) => ({
        index,
        distance: Math.hypot(p.x - center.x, p.y - center.y),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, LOUD_SIZE)
      .map(({ index }) => index),
  )

  const sampleOrder = new Map(sample.map((index, order) => [index, order]))
  const joined = new Map(
    sample.slice(0, JOINED_SIZE).map((index, order) => [index, order]),
  )

  // Waves sweep across the map in a few neighborhoods, not dot by dot.
  const cells = shuffle(
    Array.from({ length: 16 }, (_, cell) => cell),
    rand,
  )
  const cellWave = new Map(cells.map((cell, order) => [cell, order / 15]))

  return positions.map((p, index) => {
    const column = Math.min(3, Math.floor((p.x / VIEW_WIDTH) * 4))
    const row = Math.min(3, Math.floor((p.y / VIEW_HEIGHT) * 4))
    return {
      x: p.x,
      y: p.y,
      wave: cellWave.get(row * 4 + column) ?? 0,
      loud: loud.has(index),
      sample: sampleOrder.has(index),
      sampleOrder: sampleOrder.get(index) ?? -1,
      joinedOrder: joined.get(index) ?? -1,
    }
  })
}

const centroid = (
  positions: { x: number; y: number }[],
): { x: number; y: number } => {
  const xs = positions.map((p) => p.x).sort((a, b) => a - b)
  const ys = positions.map((p) => p.y).sort((a, b) => a - b)
  return { x: percentile(xs, 0.5), y: percentile(ys, 0.5) }
}

// Web Mercator, 0..1 across the world with y down: the projection the
// basemap draws in, so a dot lands on its street at every zoom.
export const toMercator = ({ lat, lng }: LatLng): { x: number; y: number } => {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat))
  const sin = Math.sin((clamped * Math.PI) / 180)
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  }
}

export const fromMercator = ({ x, y }: { x: number; y: number }): LatLng => ({
  lng: x * 360 - 180,
  lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
})

// maplibre draws the world 512px wide at zoom 0, doubling per zoom level.
export const basemapZoom = (camera: DistrictCamera, widthPx: number): number =>
  Math.log2((camera.worldUnits * widthPx) / VIEW_WIDTH / 512)

// Real locations, cut down to about TARGET_DOTS by a seeded random pick. A
// random pick keeps the district's density, so each dot stands for about the
// same number of residents. Returns null when there is too little to draw.
export const buildDistrictDots = (
  points: LatLng[],
  sampleSize = SAMPLE_SIZE,
): DistrictDots | null => {
  const unique = new Map<string, LatLng>()
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue
    unique.set(`${point.lat},${point.lng}`, point)
  }
  const all = [...unique.values()]
  if (all.length < MIN_REAL_DOTS) return null

  const projected = all.map(toMercator)

  // A few bad geocodes far outside the district would shrink it to a corner.
  const xs = projected.map((p) => p.x).sort((a, b) => a - b)
  const ys = projected.map((p) => p.y).sort((a, b) => a - b)
  const [x1, x99] = [percentile(xs, 0.01), percentile(xs, 0.99)]
  const [y1, y99] = [percentile(ys, 0.01), percentile(ys, 0.99)]
  const marginX = (x99 - x1) * 0.15
  const marginY = (y99 - y1) * 0.15
  const kept = projected.filter(
    (p) =>
      p.x >= x1 - marginX &&
      p.x <= x99 + marginX &&
      p.y >= y1 - marginY &&
      p.y <= y99 + marginY,
  )
  if (kept.length < MIN_REAL_DOTS) return null

  const minX = Math.min(...kept.map((p) => p.x))
  const maxX = Math.max(...kept.map((p) => p.x))
  const minY = Math.min(...kept.map((p) => p.y))
  const maxY = Math.max(...kept.map((p) => p.y))
  const spanX = maxX - minX || 1e-6
  const spanY = maxY - minY || 1e-6
  const fit = Math.min(
    (VIEW_WIDTH - PADDING * 2) / spanX,
    (VIEW_HEIGHT - PADDING * 2) / spanY,
  )
  const offsetX = (VIEW_WIDTH - spanX * fit) / 2
  const offsetY = (VIEW_HEIGHT - spanY * fit) / 2
  const fitted = kept.map((p) => ({
    x: offsetX + (p.x - minX) * fit,
    y: offsetY + (p.y - minY) * fit,
  }))

  const rand = seededRandom(SEED)
  const positions = shuffle(fitted, rand).slice(0, TARGET_DOTS)
  const center = centroid(positions)
  return {
    dots: assignRoles(positions, rand, center, sampleSize),
    outline: null,
    camera: {
      center: fromMercator({
        x: minX + (VIEW_WIDTH / 2 - offsetX) / fit,
        y: minY + (VIEW_HEIGHT / 2 - offsetY) / fit,
      }),
      worldUnits: fit,
    },
    abstract: false,
    center,
  }
}

const ABSTRACT_OUTLINE: [number, number][] = [
  [12, 18],
  [38, 8],
  [62, 12],
  [80, 6],
  [92, 24],
  [88, 44],
  [95, 62],
  [82, 84],
  [60, 90],
  [40, 86],
  [22, 90],
  [8, 72],
  [14, 52],
  [4, 34],
]

const insideOutline = (x: number, y: number): boolean => {
  let inside = false
  for (
    let i = 0, j = ABSTRACT_OUTLINE.length - 1;
    i < ABSTRACT_OUTLINE.length;
    j = i, i += 1
  ) {
    const [xi, yi] = ABSTRACT_OUTLINE[i]!
    const [xj, yj] = ABSTRACT_OUTLINE[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// The stand-in when an office has no location data: the same story on a
// generic district, so the step never errors.
export const buildAbstractDots = (sampleSize = SAMPLE_SIZE): DistrictDots => {
  const rand = seededRandom(SEED)
  const neighborhoods: [number, number, number][] = [
    [30, 30, 9],
    [64, 28, 8],
    [50, 46, 7],
    [34, 68, 9],
    [70, 66, 10],
  ]
  const positions: { x: number; y: number }[] = []
  let guard = 0
  while (positions.length < TARGET_DOTS && guard < 20_000) {
    guard += 1
    let x: number
    let y: number
    if (rand() < 0.45) {
      const [hx, hy, radius] =
        neighborhoods[Math.floor(rand() * neighborhoods.length)]!
      const angle = rand() * Math.PI * 2
      const distance = Math.sqrt(rand()) * radius
      x = hx + Math.cos(angle) * distance
      y = hy + Math.sin(angle) * distance
    } else {
      x = 4 + rand() * 92
      y = 6 + rand() * 84
    }
    if (insideOutline(x, y)) positions.push({ x, y })
  }
  const center = { x: 50, y: 46 }
  return {
    dots: assignRoles(positions, rand, center, sampleSize),
    outline: toPath(ABSTRACT_OUTLINE.map(([x, y]) => ({ x, y }))),
    camera: null,
    abstract: true,
    center,
  }
}

// About how many residents one dot stands for, rounded so it reads as an
// estimate rather than a count.
export const residentsPerDot = (population: number, dots: number): string => {
  if (dots <= 0) return '0'
  const raw = population / dots
  const step = raw >= 1000 ? 100 : raw >= 100 ? 10 : 1
  return Math.max(1, Math.round(raw / step) * step).toLocaleString('en-US')
}
