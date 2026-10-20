import { describe, expect, it } from 'vitest'
import {
  basemapZoom,
  buildAbstractDots,
  buildDistrictDots,
  fromMercator,
  toMercator,
  residentsPerDot,
  SAMPLE_PER_CELL,
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
    expect(model.outline).toBeNull()
    for (const dot of model.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0)
      expect(dot.x).toBeLessThanOrEqual(VIEW_WIDTH)
      expect(dot.y).toBeGreaterThanOrEqual(0)
      expect(dot.y).toBeLessThanOrEqual(VIEW_HEIGHT)
    }
  })

  it('places each dot where its location falls on the basemap', () => {
    const points = grid(2_000)
    const model = buildDistrictDots(points)!
    const camera = model.camera!
    const middle = toMercator(camera.center)
    const onView = (point: { lat: number; lng: number }) => {
      const m = toMercator(point)
      return {
        x: VIEW_WIDTH / 2 + (m.x - middle.x) * camera.worldUnits,
        y: VIEW_HEIGHT / 2 + (m.y - middle.y) * camera.worldUnits,
      }
    }
    const expected = points.map(onView)
    for (const dot of model.dots) {
      expect(
        expected.some(
          (p) => Math.abs(p.x - dot.x) < 1e-6 && Math.abs(p.y - dot.y) < 1e-6,
        ),
      ).toBe(true)
    }
    // Further north is further up the map.
    const north = onView({ lat: 41.19, lng: -104.8 })
    const south = onView({ lat: 41.1, lng: -104.8 })
    expect(north.y).toBeLessThan(south.y)
  })

  it('zooms the basemap so the view spans the same ground at any width', () => {
    const camera = buildDistrictDots(grid(2_000))!.camera!
    const zoom = basemapZoom(camera, 400)
    expect(512 * 2 ** zoom * (VIEW_WIDTH / 400)).toBeCloseTo(camera.worldUnits)
    expect(basemapZoom(camera, 800)).toBeCloseTo(zoom + 1)
  })

  it('round-trips through the projection', () => {
    const back = fromMercator(toMercator({ lat: 35.5951, lng: -82.5515 }))
    expect(back.lat).toBeCloseTo(35.5951, 6)
    expect(back.lng).toBeCloseTo(-82.5515, 6)
  })

  it('picks the same dots every time', () => {
    expect(buildDistrictDots(grid(2_000))).toEqual(
      buildDistrictDots(grid(2_000)),
    )
  })

  it('picks a few sample dots per part, 12 loud dots and half of the sample that join', () => {
    const { dots } = buildDistrictDots(grid(2_000))!
    const sample = dots.filter((dot) => dot.sample)
    expect(sample.length).toBeGreaterThan(0)
    expect(sample.length).toBeLessThanOrEqual(16 * SAMPLE_PER_CELL)
    expect(dots.filter((dot) => dot.loud)).toHaveLength(12)
    const joined = dots.filter((dot) => dot.joinedOrder >= 0)
    expect(joined).toHaveLength(Math.ceil(sample.length / 2))
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
    expect(model.camera).toBeNull()
    expect(model.outline).toMatch(/^M/)
    expect(model.dots).toHaveLength(TARGET_DOTS)
    expect(model.dots.filter((dot) => dot.sample).length).toBeGreaterThan(0)
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
