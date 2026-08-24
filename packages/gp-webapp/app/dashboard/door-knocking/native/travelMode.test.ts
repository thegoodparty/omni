import { describe, expect, it } from 'vitest'
import {
  estimateTravelSeconds,
  suggestTravelMode,
  WALKABLE_LEG_METERS,
} from './travelMode'

// 0.001° of latitude is ~111m anywhere, so latitude steps are a readable way to
// place stops a known distance apart.
const METERS_PER_DEGREE_LAT = 111_320
const northOf = (lat: number, meters: number) =>
  lat + meters / METERS_PER_DEGREE_LAT

const chain = (count: number, spacingMeters: number): Array<[number, number]> =>
  Array.from({ length: count }, (_, index) => [
    -86.78,
    northOf(36.16, index * spacingMeters),
  ])

describe('suggestTravelMode', () => {
  it('suggests walking when every leg is a short walk', () => {
    expect(suggestTravelMode(chain(20, 80))).toBe('walk')
  })

  // The rule is every leg, not the average one: a list of tight clusters with a
  // single long hop between them is a drive list, because no visit order can
  // avoid that hop.
  it('suggests driving for two clusters a long way apart', () => {
    const stops: Array<[number, number]> = [
      ...chain(5, 60),
      ...chain(5, 60).map(([lng, lat]): [number, number] => [
        lng,
        northOf(lat, 1_200),
      ]),
    ]

    expect(suggestTravelMode(stops)).toBe('drive')
  })

  // Order-independent: the stops arrive in pack order, not visit order, so a
  // walkable list must not read as a drive list just because the array
  // interleaves its two ends. A nearest-neighbour walk of this array would
  // report a long leg; the spanning chain doesn't.
  it('ignores the order the stops arrive in', () => {
    const inOrder = chain(8, 100)
    const interleaved = [
      ...inOrder.filter((_, index) => index % 2 === 0),
      ...inOrder.filter((_, index) => index % 2 === 1),
    ]

    expect(suggestTravelMode(interleaved)).toBe('walk')
    expect(suggestTravelMode(inOrder)).toBe('walk')
  })

  it('walks a list with nothing to compare', () => {
    expect(suggestTravelMode([])).toBe('walk')
    expect(suggestTravelMode([[-86.78, 36.16]])).toBe('walk')
  })

  // Straight-line metres are discounted before they become minutes, since a
  // real walk between two doors is longer than the line between them.
  it('turns five minutes of walking into a threshold under 400m', () => {
    expect(WALKABLE_LEG_METERS).toBeGreaterThan(250)
    expect(WALKABLE_LEG_METERS).toBeLessThan(400)
  })
})

describe('estimateTravelSeconds', () => {
  // Only ever applied to the mode we did NOT buy: the bought mode's duration is
  // Geoapify's own totalSeconds and is never replaced by this.
  it('reads the same distance faster by car than on foot', () => {
    const walking = estimateTravelSeconds(5_000, 'walk')
    const driving = estimateTravelSeconds(5_000, 'drive')

    expect(walking).toBe(3_600)
    expect(driving).toBeLessThan(walking)
    expect(driving).toBe(720)
  })
})
