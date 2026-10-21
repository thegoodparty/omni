import {
  PANEL_MIN_MEMBERS_FOR_BALANCE,
  type CivicPanelCompositionGroup,
  type CivicPanelCompositionPlace,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'

// The district as a 100-seat half circle, and the panel's groups as petals:
// pure geometry and allocation, drawn by CivicPanelSeats and
// CivicPanelBloom.

export const SEAT_COUNT = 100
const SEAT_ROWS = 6
export const SEAT_R_OUT = 200
const SEAT_R_IN = SEAT_R_OUT * 0.5
export const SEAT_SIZE = 14
// A place is behind when it has filled less than half as much of its share
// as the panel has of the whole.
export const BEHIND_AT = 0.5
export const LIST_SIZE = 5
// Past this many places there is no room to name them around the arc, so
// the ones with the most empty seats are listed under it instead.
export const LABEL_ALL_UP_TO = 12
// Near its goal the chart turns from who is behind to where seats are empty.
export const NEAR_FULL_AT = 0.8

// Largest remainder, ties to the bigger weight, so the parts always sum to
// the total. A part never passes its cap.
export const allocate = (
  weights: number[],
  total: number,
  caps?: number[],
): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0 || total <= 0) return weights.map(() => 0)
  const capOf = (i: number) => caps?.[i] ?? Infinity
  const raw = weights.map((w) => (w * total) / sum)
  const out = raw.map((r, i) => Math.min(Math.floor(r), capOf(i)))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (raw[b] ?? 0) - (out[b] ?? 0) - ((raw[a] ?? 0) - (out[a] ?? 0)) ||
        (weights[b] ?? 0) - (weights[a] ?? 0),
    )
  // Caps can leave seats over after one pass; keep going while any part
  // still has room.
  while (left > 0) {
    let placed = false
    for (const i of order) {
      if (left <= 0) break
      if ((out[i] ?? 0) >= capOf(i) || (weights[i] ?? 0) <= 0) continue
      out[i] = (out[i] ?? 0) + 1
      left -= 1
      placed = true
    }
    if (!placed) break
  }
  return out
}

// Server and client can differ in a coordinate's last float digit, which
// React reports as a hydration mismatch, so every drawn coordinate is
// rounded to hundredths.
export const roundCoord = (value: number): number =>
  Math.round(value * 100) / 100

// A point `r` out from (cx, cy) at angle `a`, y pointing down.
export const polar = (
  cx: number,
  cy: number,
  r: number,
  a: number,
): { x: number; y: number } => ({
  x: roundCoord(cx + r * Math.cos(a)),
  y: roundCoord(cy + r * Math.sin(a)),
})

export interface Spot {
  x: number
  y: number
  angle: number
}

// Seat centers on SEAT_ROWS arcs, outer rows holding more, ordered left to
// right so consecutive seats sit together.
export const seatSpots = (cx: number, cy: number): Spot[] => {
  const radii = Array.from(
    { length: SEAT_ROWS },
    (_, k) => SEAT_R_IN + (k * (SEAT_R_OUT - SEAT_R_IN)) / (SEAT_ROWS - 1),
  )
  const sumR = radii.reduce((a, b) => a + b, 0)
  const perRow = radii.map((r) => Math.round((SEAT_COUNT * r) / sumR))
  perRow[SEAT_ROWS - 1] =
    (perRow[SEAT_ROWS - 1] ?? 0) +
    SEAT_COUNT -
    perRow.reduce((a, b) => a + b, 0)
  const spots: Array<Spot & { r: number }> = []
  radii.forEach((r, k) => {
    const n = perRow[k] ?? 0
    for (let j = 0; j < n; j++) {
      const angle = Math.PI - (j * Math.PI) / (n - 1)
      spots.push({
        r,
        angle,
        x: roundCoord(cx + r * Math.cos(angle)),
        y: roundCoord(cy - r * Math.sin(angle)),
      })
    }
  })
  return spots
    .sort((p, q) => q.angle - p.angle || p.r - q.r)
    .map(({ x, y, angle }) => ({ x, y, angle }))
}

export type LabelAnchor = 'start' | 'middle' | 'end'

// Which side of its point a label reads from, by where it sits around a
// circle: right of center reads outward to the right, left to the left.
export const labelAnchor = (cos: number): LabelAnchor =>
  cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'

// Two-line labels down one side of the arc, moved up as needed so no two
// overlap. Moving up keeps a label outside the arc, since the arc narrows
// faster than the labels' circle. Labels are matched by index.
export const LABEL_SPACING = 34
export const spreadLabels = (ys: number[]): number[] => {
  const out = [...ys]
  const order = ys.map((_, i) => i).sort((a, b) => (ys[b] ?? 0) - (ys[a] ?? 0))
  let floor = Infinity
  for (const i of order) {
    const y = roundCoord(Math.min(out[i] ?? 0, floor - LABEL_SPACING))
    out[i] = y
    floor = y
  }
  return out
}

export interface SeatPlace {
  key: string
  name: string
  count: number
  filled: number
  empty: number
  progress: number
  behind: boolean
  // Alternate places take alternate shades so neighbors read apart.
  shade: 0 | 1
  // Middle of the place's seats, for its label.
  angle: number
}

export interface Seat {
  x: number
  y: number
  place: number
  filled: boolean
}

export type SeatsStage = 'tooEarly' | 'building' | 'nearFull' | 'full'

export interface SeatChart {
  seats: Seat[]
  // Only places holding at least one seat.
  places: SeatPlace[]
  filled: number
  stage: SeatsStage
  // Behind places, furthest first.
  behind: SeatPlace[]
  // Places with an empty seat, the most empty first.
  mostEmpty: SeatPlace[]
}

// The goal as 100 seats, split by each place's share of the district. A
// place's members fill seats only up to its share of the goal, and before
// PANEL_MIN_MEMBERS_FOR_BALANCE members nothing is called behind.
export const buildSeats = ({
  places,
  members,
  goal,
  cx,
  cy,
}: {
  places: CivicPanelCompositionPlace[]
  members: number
  goal: number
  cx: number
  cy: number
}): SeatChart => {
  const target = Math.max(1, goal)
  const shareSum = places.reduce((a, p) => a + p.districtShare, 0) || 1
  const shares = places.map((p) => p.districtShare / shareSum)
  const seatsFor = allocate(shares, SEAT_COUNT)
  // A place with no seat fills none, so its members never count toward the
  // seats others show.
  const counted = places.map((p, i) =>
    (seatsFor[i] ?? 0) > 0 ? Math.min(p.members, (shares[i] ?? 0) * target) : 0,
  )
  const filledTotal = Math.min(
    SEAT_COUNT,
    Math.round((counted.reduce((a, b) => a + b, 0) / target) * SEAT_COUNT),
  )
  // Never more seats than a place's own members earn, nor than it has.
  const earned = counted.map((c, i) =>
    Math.min(seatsFor[i] ?? 0, Math.ceil((c / target) * SEAT_COUNT)),
  )
  const filledFor = allocate(counted, filledTotal, earned)
  const placed = places.reduce((a, p) => a + p.members, 0)
  const overall = placed / target
  const canTell = members >= PANEL_MIN_MEMBERS_FOR_BALANCE

  const spots = seatSpots(cx, cy)
  const seats: Seat[] = []
  const rows: SeatPlace[] = []
  let cursor = 0
  places.forEach((p, i) => {
    const count = seatsFor[i] ?? 0
    if (count === 0) return
    const filled = filledFor[i] ?? 0
    const share = shares[i] ?? 0
    const progress = share > 0 ? p.members / (share * target) : 1
    const mine = spots.slice(cursor, cursor + count)
    cursor += count
    const index = rows.length
    mine.forEach((spot, k) =>
      seats.push({ x: spot.x, y: spot.y, place: index, filled: k < filled }),
    )
    const first = mine[0]?.angle ?? 0
    const last = mine[mine.length - 1]?.angle ?? first
    rows.push({
      key: p.key,
      name: p.name,
      count,
      filled,
      empty: count - filled,
      progress,
      behind: canTell && progress < overall * BEHIND_AT,
      shade: index % 2 === 0 ? 0 : 1,
      angle: (first + last) / 2,
    })
  })

  const full = rows.every((r) => r.empty === 0)
  const stage: SeatsStage = !canTell
    ? 'tooEarly'
    : full
      ? 'full'
      : members >= target * NEAR_FULL_AT
        ? 'nearFull'
        : 'building'
  return {
    seats,
    places: rows,
    filled: filledTotal,
    stage,
    behind: rows
      .filter((r) => r.behind)
      .sort((a, b) => a.progress - b.progress),
    mostEmpty: rows
      .filter((r) => r.empty > 0)
      .sort((a, b) => b.empty - a.empty || a.progress - b.progress),
  }
}

// Petals: one per group, growing with members share over district share,
// capped at twice it. The ring is a ratio of 1.
export const BLOOM_R0 = 46
export const BLOOM_RMAX = 150
export const MAX_RATIO = 2
// Within a fifth of its share either way, a group is about even.
export const EVEN_WITHIN = 0.2

export const bloomRadius = (ratio: number): number =>
  BLOOM_R0 +
  (Math.min(Math.max(ratio, 0), MAX_RATIO) / MAX_RATIO) *
    (BLOOM_RMAX - BLOOM_R0)

export type PetalBucket = 'over' | 'under' | 'even'

export const petalBucket = (ratio: number): PetalBucket =>
  Math.abs(ratio - 1) < EVEN_WITHIN ? 'even' : ratio > 1 ? 'over' : 'under'

export interface Petal {
  group: UnderrepresentedGroup
  ratio: number
  bucket: PetalBucket
  // Whole percent of its share, for the label.
  percent: number
  radius: number
  a0: number
  a1: number
  mid: number
}

export interface Bloom {
  petals: Petal[]
  atShare: number
  ringRadius: number
  // The group furthest under its share, null when none is.
  furthestUnder: UnderrepresentedGroup | null
}

export const buildBloom = (groups: CivicPanelCompositionGroup[]): Bloom => {
  const n = groups.length
  const step = n > 0 ? (Math.PI * 2) / n : 0
  const gap = Math.min(0.05, step * 0.2)
  const petals = groups.map((g, i) => {
    const ratio = g.districtShare > 0 ? g.memberShare / g.districtShare : 1
    const a0 = -Math.PI / 2 - step / 2 + i * step + gap / 2
    const a1 = a0 + step - gap
    return {
      group: g.group,
      ratio,
      bucket: petalBucket(ratio),
      percent: Math.round(ratio * 100),
      radius: Math.max(bloomRadius(ratio), BLOOM_R0 + 4),
      a0,
      a1,
      mid: (a0 + a1) / 2,
    }
  })
  const under = petals
    .filter((p) => p.bucket === 'under')
    .sort((a, b) => a.ratio - b.ratio)
  return {
    petals,
    atShare: petals.filter((p) => p.bucket !== 'under').length,
    ringRadius: bloomRadius(1),
    furthestUnder: under[0]?.group ?? null,
  }
}

const point = (cx: number, cy: number, r: number, a: number) => {
  const { x, y } = polar(cx, cy, r, a)
  return `${x} ${y}`
}

// A ring sector from r0 to r1 between two angles, clockwise.
export const sectorPath = (
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string => {
  const large = a1 - a0 > Math.PI ? 1 : 0
  return [
    `M ${point(cx, cy, r0, a0)}`,
    `L ${point(cx, cy, r1, a0)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${point(cx, cy, r1, a1)}`,
    `L ${point(cx, cy, r0, a1)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${point(cx, cy, r0, a0)}`,
    'Z',
  ].join(' ')
}

export type MilestoneState = 'done' | 'next' | 'upcoming'
export type MilestoneKey = 'firstYes' | 'canCompare' | 'halfway' | 'full'

export interface Milestone {
  key: MilestoneKey
  at: number
  state: MilestoneState
}

// The panel's four milestones from its goal: a first yes, enough members to
// compare with the district, half the goal and the goal. The first not yet
// reached is next.
export const milestones = (members: number, goal: number): Milestone[] => {
  const steps: Array<[MilestoneKey, number]> = [
    ['firstYes', 1],
    ['canCompare', PANEL_MIN_MEMBERS_FOR_BALANCE],
    ['halfway', Math.ceil(goal / 2)],
    ['full', goal],
  ]
  const next = steps.find(([, at]) => members < at)?.[0]
  return steps.map(([key, at]) => ({
    key,
    at,
    state: members >= at ? 'done' : key === next ? 'next' : 'upcoming',
  }))
}
