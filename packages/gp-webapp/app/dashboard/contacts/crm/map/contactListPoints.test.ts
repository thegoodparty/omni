import { describe, expect, it } from 'vitest'
import type { Person } from '../shared/contacts-types'
import { boundsOf, toContactPoints } from './contactListPoints'

const person = (
  id: string,
  latitude: string | null,
  longitude: string | null,
): Person =>
  ({
    id,
    firstName: 'Test',
    lastName: id,
    address: { latitude, longitude },
  }) as unknown as Person

describe('toContactPoints', () => {
  // The apartment case, and the reason this groups by coordinate at all: every
  // unit in a building shares one lat/lon in the voter file.
  it('collapses everyone sharing a coordinate into one point', () => {
    const { points } = toContactPoints([
      person('a', '44.7593', '-85.6175'),
      person('b', '44.7593', '-85.6175'),
      person('c', '44.7600', '-85.6180'),
    ])
    expect(points).toHaveLength(2)
    expect(points[0]?.residents.map((r) => r.id)).toEqual(['a', 'b'])
    expect(points[1]?.residents.map((r) => r.id)).toEqual(['c'])
  })

  it('keeps residents in list order within a point', () => {
    const { points } = toContactPoints([
      person('first', '1', '2'),
      person('second', '1', '2'),
    ])
    expect(points[0]?.residents.map((r) => r.id)).toEqual(['first', 'second'])
  })

  // Counted rather than dropped: a map that quietly omits people looks
  // complete and is not.
  it('counts people with no coordinates instead of dropping them silently', () => {
    const { points, unmappable } = toContactPoints([
      person('mapped', '44.75', '-85.61'),
      person('noLat', null, '-85.61'),
      person('noLng', '44.75', null),
    ])
    expect(points).toHaveLength(1)
    expect(unmappable).toBe(2)
  })

  it('counts an unparseable coordinate as unmappable', () => {
    const { points, unmappable } = toContactPoints([
      person('bad', 'not-a-number', '-85.61'),
    ])
    expect(points).toHaveLength(0)
    expect(unmappable).toBe(1)
  })

  it('has nothing to map for an empty list', () => {
    expect(toContactPoints([])).toEqual({ points: [], unmappable: 0 })
  })
})

describe('boundsOf', () => {
  it('spans every point', () => {
    const { points } = toContactPoints([
      person('a', '44.0', '-85.0'),
      person('b', '45.0', '-86.0'),
    ])
    expect(boundsOf(points)).toEqual({
      minLat: 44,
      maxLat: 45,
      minLng: -86,
      maxLng: -85,
    })
  })

  // A single point is a valid list, and a zero-area box is what fitBounds
  // wants for it — returning null here would leave the camera over the US.
  it('returns a zero-area box for one point rather than nothing', () => {
    const { points } = toContactPoints([person('a', '44.0', '-85.0')])
    expect(boundsOf(points)).toEqual({
      minLat: 44,
      maxLat: 44,
      minLng: -85,
      maxLng: -85,
    })
  })

  it('has no bounds when nothing is mappable', () => {
    expect(boundsOf([])).toBeNull()
  })
})
