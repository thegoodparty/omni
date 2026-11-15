import { describe, expect, it } from 'vitest'
import {
  allocate,
  bloomRadius,
  BLOOM_R0,
  BLOOM_RMAX,
  buildBloom,
  buildSeats,
  labelAnchor,
  petalBucket,
  LABEL_SPACING,
  milestones,
  plainSeats,
  SEAT_COUNT,
  SEAT_HUES,
  polar,
  roundCoord,
  seatSpots,
  sectorPath,
  shortGroups,
  spreadLabels,
} from './panelCharts'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

// Fifteen tracts of uneven size, as a city district reads.
const SHARES = [
  0.14, 0.12, 0.09, 0.08, 0.08, 0.07, 0.07, 0.06, 0.06, 0.06, 0.05, 0.05, 0.04,
  0.02, 0.01,
]
const placesWith = (members: (share: number, i: number) => number) =>
  SHARES.map((share, i) => ({
    key: `370210${String(i + 1).padStart(3, '0')}00`,
    name: String(i + 1),
    districtShare: share,
    members: members(share, i),
  }))

const seatsAt = (members: number, mix: (share: number, i: number) => number) =>
  buildSeats({
    places: placesWith(mix),
    members,
    goal: 240,
    cx: 0,
    cy: 0,
  })

describe('allocate', () => {
  it('always sums to the total, by largest remainder', () => {
    expect(sum(allocate(SHARES, 100))).toBe(100)
    expect(sum(allocate([1, 1, 1], 100))).toBe(100)
    expect(allocate([1, 1, 1], 100)).toEqual([34, 33, 33])
    expect(allocate([0.5, 0.25, 0.25], 3)).toEqual([1, 1, 1])
    expect(allocate([0.3, 0.2], 1)).toEqual([1, 0])
  })

  it('never passes a cap, and gives nothing to a zero weight', () => {
    const out = allocate([10, 10, 0], 10, [3, 10, 10])
    expect(out).toEqual([3, 7, 0])
  })

  it('gives nothing when there is nothing to share', () => {
    expect(allocate([0, 0], 5)).toEqual([0, 0])
    expect(allocate([1, 2], 0)).toEqual([0, 0])
  })
})

describe('seatSpots', () => {
  it('lays 100 seats left to right on a half circle', () => {
    const spots = seatSpots(0, 0)
    expect(spots).toHaveLength(SEAT_COUNT)
    expect(spots[0]?.angle).toBeCloseTo(Math.PI)
    expect(spots[SEAT_COUNT - 1]?.angle).toBeCloseTo(0)
    expect(spots.every((spot) => spot.y <= 1e-9)).toBe(true)
  })
})

// At most two decimals: what the server and the browser both print the same.
const isRounded = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

describe('rounded coordinates', () => {
  it('rounds to hundredths', () => {
    expect(roundCoord(79.03442061568629)).toBe(79.03)
    expect(roundCoord(79.03442061568626)).toBe(79.03)
  })

  it('rounds every seat and label point', () => {
    for (const spot of seatSpots(300, 214)) {
      expect(isRounded(spot.x)).toBe(true)
      expect(isRounded(spot.y)).toBe(true)
    }
    for (let a = 0; a < Math.PI * 2; a += 0.37) {
      const { x, y } = polar(300, 220, 164, a)
      expect(isRounded(x)).toBe(true)
      expect(isRounded(y)).toBe(true)
    }
    expect(spreadLabels([-79.03442061568629, -80.1]).every(isRounded)).toBe(
      true,
    )
  })

  it('draws petals with rounded points', () => {
    const numbers = sectorPath(300, 220, 46.123456, 60.18181818, -1.9, -1.1)
      .split(/[^0-9.-]+/)
      .filter(Boolean)
      .map(Number)
    expect(numbers.every(isRounded)).toBe(true)
  })
})

describe('labelAnchor', () => {
  it('reads outward from the side a label sits on', () => {
    expect(labelAnchor(1)).toBe('start')
    expect(labelAnchor(-1)).toBe('end')
    expect(labelAnchor(0)).toBe('middle')
    expect(labelAnchor(0.2)).toBe('middle')
  })
})

describe('spreadLabels', () => {
  it('moves crowded labels up until none overlap, leaving the lowest', () => {
    expect(spreadLabels([0, -10, -100])).toEqual([0, -LABEL_SPACING, -100])
    expect(spreadLabels([-5, 0, -2])).toEqual([
      -LABEL_SPACING * 2,
      0,
      -LABEL_SPACING,
    ])
  })
})

describe('buildSeats', () => {
  it('gives every tract its share of 100 seats', () => {
    const chart = seatsAt(0, () => 0)
    expect(sum(chart.places.map((p) => p.count))).toBe(SEAT_COUNT)
    expect(chart.seats).toHaveLength(SEAT_COUNT)
    expect(chart.places[0]?.count).toBe(14)
    expect(chart.filled).toBe(0)
    expect(chart.stage).toBe('tooEarly')
  })

  it('leaves out a tract too small for a seat', () => {
    const chart = buildSeats({
      places: [
        { key: 'a', name: '1', districtShare: 0.996, members: 0 },
        { key: 'b', name: '2', districtShare: 0.004, members: 0 },
      ],
      members: 0,
      goal: 240,
      cx: 0,
      cy: 0,
    })
    expect(chart.places.map((p) => p.count)).toEqual([100])
  })

  it('lights no seat its own members did not earn, among many seatless places', () => {
    // 20 places with seats and 300 too small for one, every member in the
    // seatless ones but one place.
    const places = [
      ...Array.from({ length: 20 }, (_, i) => ({
        key: `big-${i}`,
        name: `${i}`,
        districtShare: 0.04,
        members: i === 0 ? 5 : 0,
      })),
      ...Array.from({ length: 300 }, (_, i) => ({
        key: `small-${i}`,
        name: `s${i}`,
        districtShare: 0.2 / 300,
        members: 1,
      })),
    ]
    const chart = buildSeats({ places, members: 305, goal: 240, cx: 0, cy: 0 })
    expect(sum(chart.places.map((p) => p.count))).toBe(SEAT_COUNT)
    for (const place of chart.places) {
      const own = places.find((p) => p.key === place.key)?.members ?? 0
      if (own === 0) expect(place.filled).toBe(0)
      expect(place.filled).toBeLessThanOrEqual(
        Math.ceil((own / 240) * SEAT_COUNT),
      )
    }
    expect(chart.places.find((p) => p.key === 'big-0')?.filled).toBe(2)
    expect(chart.filled).toBe(sum(chart.places.map((p) => p.filled)))
  })

  it('calls nobody behind before the panel can tell', () => {
    const chart = seatsAt(20, (_, i) => (i === 0 ? 20 : 0))
    expect(chart.stage).toBe('tooEarly')
    expect(chart.behind).toEqual([])
  })

  it('calls a tract behind under half the panel’s pace, furthest first', () => {
    // About half the goal, even across tracts but the last three. The last
    // has 1 of its 2.4: short, but not under half the panel's pace.
    const chart = seatsAt(120, (share, i) =>
      i >= 12 ? (i === 14 ? 1 : 0) : Math.round(share * 240 * 0.5),
    )
    expect(chart.stage).toBe('building')
    expect(chart.behind.map((p) => p.key)).toEqual([
      '37021001300',
      '37021001400',
    ])
    expect(chart.places.find((p) => p.key === '37021001500')?.behind).toBe(
      false,
    )
  })

  it('fills a tract only up to its share of the goal', () => {
    // Everyone from the first tract: it fills, nothing else does.
    const chart = seatsAt(120, (_, i) => (i === 0 ? 120 : 0))
    expect(chart.places[0]?.filled).toBe(14)
    expect(chart.filled).toBe(14)
  })

  it('turns to empty seats near the goal, and is full when every seat is', () => {
    const near = seatsAt(200, (share, i) =>
      i === 0 ? 0 : Math.round(share * 240 * 1.1),
    )
    expect(near.stage).toBe('nearFull')
    expect(near.mostEmpty[0]?.key).toBe('37021000100')

    const full = seatsAt(240, (share) => Math.ceil(share * 240))
    expect(full.stage).toBe('full')
    expect(full.filled).toBe(SEAT_COUNT)
  })

  it('gives neighboring places different color families, red, blue, lavender in arc order', () => {
    const chart = seatsAt(120, (share) => Math.round(share * 240))
    const hues = chart.places.map((p) => p.hue)
    expect(hues.slice(0, 3)).toEqual([...SEAT_HUES])
    hues.slice(1).forEach((hue, i) => expect(hue).not.toBe(hues[i]))
  })

  it('varies the tint within a place', () => {
    const chart = seatsAt(240, (share) => Math.ceil(share * 240))
    const tints = chart.seats.filter((s) => s.place === 0).map((s) => s.tint)
    expect(new Set(tints)).toEqual(new Set([0, 1, 2]))
  })

  it('colors the same seats the same way every time', () => {
    const mix = (share: number, i: number) => Math.round(share * 200) + (i % 4)
    const first = seatsAt(200, mix)
    const again = seatsAt(200, mix)
    expect(again.seats).toEqual(first.seats)
    expect(again.places.map((p) => p.hue)).toEqual(
      first.places.map((p) => p.hue),
    )
  })
})

describe('petals', () => {
  it('buckets a ratio within a fifth of even as even', () => {
    expect(petalBucket(1)).toBe('even')
    expect(petalBucket(1.19)).toBe('even')
    expect(petalBucket(0.81)).toBe('even')
    expect(petalBucket(1.25)).toBe('over')
    expect(petalBucket(0.5)).toBe('under')
  })

  it('grows with the ratio and stops at twice the share', () => {
    expect(bloomRadius(0)).toBe(BLOOM_R0)
    expect(bloomRadius(2)).toBe(BLOOM_RMAX)
    expect(bloomRadius(5)).toBe(BLOOM_RMAX)
    expect(bloomRadius(1)).toBe((BLOOM_R0 + BLOOM_RMAX) / 2)
  })

  it('counts groups at their share and names the one furthest under', () => {
    const bloom = buildBloom([
      { group: 'age18to24', districtShare: 0.11, memberShare: 0.03 },
      { group: 'age65plus', districtShare: 0.21, memberShare: 0.26 },
      { group: 'women', districtShare: 0.52, memberShare: 0.57 },
      { group: 'men', districtShare: 0.48, memberShare: 0.3 },
    ])
    expect(bloom.atShare).toBe(2)
    expect(bloom.furthestUnder).toBe('age18to24')
    expect(bloom.petals.map((p) => p.bucket)).toEqual([
      'under',
      'over',
      'even',
      'under',
    ])
    expect(bloom.petals[0]?.percent).toBe(27)
    // The first petal points straight up.
    expect(bloom.petals[0]?.mid).toBeCloseTo(-Math.PI / 2)
  })
})

describe('milestones', () => {
  it('reads the goal for halfway and full, and marks the first not reached', () => {
    expect(milestones(0, 240)).toEqual([
      { key: 'firstYes', at: 1, state: 'next' },
      { key: 'canCompare', at: 30, state: 'upcoming' },
      { key: 'halfway', at: 120, state: 'upcoming' },
      { key: 'full', at: 240, state: 'upcoming' },
    ])
    expect(milestones(130, 230).map((m) => [m.at, m.state])).toEqual([
      [1, 'done'],
      [30, 'done'],
      [115, 'done'],
      [230, 'next'],
    ])
    expect(milestones(250, 240).every((m) => m.state === 'done')).toBe(true)
  })
})

describe('plainSeats', () => {
  it('fills the share of the goal, in order, never past 100', () => {
    const half = plainSeats(120, 240)
    expect(half.filled).toBe(50)
    expect(half.seats.filter((seat) => seat.filled)).toHaveLength(50)
    expect(half.seats.slice(0, 50).every((seat) => seat.filled)).toBe(true)
    expect(plainSeats(300, 240).filled).toBe(SEAT_COUNT)
    expect(plainSeats(0, 240).filled).toBe(0)
  })

  it('mixes the brand families and calls no place behind', () => {
    const chart = plainSeats(240, 240)
    expect(new Set(chart.seats.map((seat) => seat.place)).size).toBe(
      SEAT_HUES.length,
    )
    expect(chart.behind).toEqual([])
  })
})

describe('shortGroups', () => {
  const composition = {
    placeKind: 'tract' as const,
    places: [
      {
        key: 'a',
        name: '1',
        label: 'Oakdale',
        districtShare: 0.5,
        members: 60,
      },
      { key: 'b', name: '2', districtShare: 0.5, members: 10 },
    ],
    groups: [
      { group: 'women' as const, districtShare: 0.5, memberShare: 0.6 },
      { group: 'men' as const, districtShare: 0.5, memberShare: 0.4 },
      { group: 'age18to24' as const, districtShare: 0.1, memberShare: 0.01 },
    ],
  }

  it('lists only groups short of their seats, furthest behind first', () => {
    const rows = shortGroups({ composition, members: 70, goal: 100 })
    expect(rows.map((row) => row.key)).toEqual([
      'age18to24',
      'b',
      'men',
      'women',
    ])
    expect(rows[0]).toMatchObject({ have: 1, need: 10 })
    expect(rows.find((row) => row.key === 'a')).toBeUndefined()
  })

  it('counts a place in the seats the district gives it', () => {
    const row = shortGroups({ composition, members: 70, goal: 100 }).find(
      (r) => r.key === 'b',
    )
    expect(row).toMatchObject({ kind: 'place', have: 10, need: 50 })
  })
})
