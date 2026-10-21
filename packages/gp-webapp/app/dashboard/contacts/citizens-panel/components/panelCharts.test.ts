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
  SEAT_COUNT,
  seatSpots,
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
