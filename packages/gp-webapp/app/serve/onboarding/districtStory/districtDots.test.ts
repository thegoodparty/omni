import { describe, expect, it } from 'vitest'
import {
  buildAbstractDots,
  buildDistrictDots,
  residentsPerDot,
  TARGET_DOTS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from './districtDots'

const grid = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    lat: 41.1 + (index % 100) * 0.001,
    lng: -104.8 + Math.floor(index / 100) * 0.001,
  }))

describe('buildDistrictDots', () => {
  it('cuts a large district down to the target number of dots', () => {
    const model = buildDistrictDots(grid(10_000))!
    expect(model.dots).toHaveLength(TARGET_DOTS)
    expect(model.abstract).toBe(false)
    expect(model.outline).toMatch(/^M/)
    for (const dot of model.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0)
      expect(dot.x).toBeLessThanOrEqual(VIEW_WIDTH)
      expect(dot.y).toBeGreaterThanOrEqual(0)
      expect(dot.y).toBeLessThanOrEqual(VIEW_HEIGHT)
    }
  })

  it('picks the same dots every time', () => {
    expect(buildDistrictDots(grid(2_000))).toEqual(
      buildDistrictDots(grid(2_000)),
    )
  })

  it('picks a sample of the asked size, 12 loud dots and 38 that join', () => {
    const { dots } = buildDistrictDots(grid(2_000), 92)!
    expect(dots.filter((dot) => dot.sample)).toHaveLength(92)
    expect(dots.filter((dot) => dot.loud)).toHaveLength(12)
    const joined = dots.filter((dot) => dot.joinedOrder >= 0)
    expect(joined).toHaveLength(38)
    expect(joined.every((dot) => dot.sample)).toBe(true)
  })

  it('keeps a stray geocode from shrinking the district into a corner', () => {
    const model = buildDistrictDots([...grid(1_000), { lat: 10, lng: 10 }])!
    const ys = model.dots.map((dot) => dot.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(50)
  })

  it('draws nothing from too few locations', () => {
    expect(buildDistrictDots(grid(50))).toBeNull()
    expect(buildDistrictDots([])).toBeNull()
  })
})

describe('buildAbstractDots', () => {
  it('draws a stand-in district with the same picks', () => {
    const model = buildAbstractDots()
    expect(model.abstract).toBe(true)
    expect(model.dots).toHaveLength(TARGET_DOTS)
    expect(model.dots.filter((dot) => dot.sample)).toHaveLength(100)
  })
})

describe('residentsPerDot', () => {
  it('rounds to a number that reads as an estimate', () => {
    expect(residentsPerDot(32_000, 640)).toBe('50')
    expect(residentsPerDot(320_000, 640)).toBe('500')
    expect(residentsPerDot(1_000_000, 640)).toBe('1,600')
    expect(residentsPerDot(300, 640)).toBe('1')
  })
})
