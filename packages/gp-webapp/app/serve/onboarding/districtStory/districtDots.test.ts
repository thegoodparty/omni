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
  SQUARE_VIEW_HEIGHT,
  VIEW_WIDTH,
  WIDE_VIEW_HEIGHT,
} from './districtDots'

const grid = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    lat: 41.1 + (index % 100) * 0.001,
    lng: -104.8 + Math.floor(index / 100) * 0.001,
  }))

describe('buildDistrictDots', () => {
  it('cuts a large district down to the target number of dots', () => {
    const model = buildDistrictDots(grid(10_000), SQUARE_VIEW_HEIGHT)!
    expect(model.dots).toHaveLength(TARGET_DOTS)
    expect(model.abstract).toBe(false)
    expect(model.outline).toBeNull()
    for (const dot of model.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0)
      expect(dot.x).toBeLessThanOrEqual(VIEW_WIDTH)
      expect(dot.y).toBeGreaterThanOrEqual(0)
      expect(dot.y).toBeLessThanOrEqual(SQUARE_VIEW_HEIGHT)
    }
  })

  it('fits the dots inside the wide phone frame too', () => {
    const model = buildDistrictDots(grid(10_000), WIDE_VIEW_HEIGHT)!
    expect(model.viewHeight).toBe(WIDE_VIEW_HEIGHT)
    for (const dot of model.dots) {
      expect(dot.y).toBeGreaterThanOrEqual(0)
      expect(dot.y).toBeLessThanOrEqual(WIDE_VIEW_HEIGHT)
    }
  })

  it('places each dot where its location falls on the basemap', () => {
    const points = grid(2_000)
    const model = buildDistrictDots(points, SQUARE_VIEW_HEIGHT)!
    const camera = model.camera!
    const middle = toMercator(camera.center)
    const onView = (point: { lat: number; lng: number }) => {
      const m = toMercator(point)
      return {
        x: VIEW_WIDTH / 2 + (m.x - middle.x) * camera.worldUnits,
        y: SQUARE_VIEW_HEIGHT / 2 + (m.y - middle.y) * camera.worldUnits,
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
    const camera = buildDistrictDots(grid(2_000), SQUARE_VIEW_HEIGHT)!.camera!
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
    expect(buildDistrictDots(grid(2_000), SQUARE_VIEW_HEIGHT)).toEqual(
      buildDistrictDots(grid(2_000), SQUARE_VIEW_HEIGHT),
    )
  })

  it('picks a few sample dots per part, 12 loud dots and half of the sample that join', () => {
    const { dots } = buildDistrictDots(grid(2_000), SQUARE_VIEW_HEIGHT)!
    const sample = dots.filter((dot) => dot.sample)
    expect(sample.length).toBeGreaterThan(0)
    expect(sample.length).toBeLessThanOrEqual(16 * SAMPLE_PER_CELL)
    expect(dots.filter((dot) => dot.loud)).toHaveLength(12)
    const joined = dots.filter((dot) => dot.joinedOrder >= 0)
    expect(joined).toHaveLength(Math.ceil(sample.length / 2))
    expect(joined.every((dot) => dot.sample)).toBe(true)
  })

  it('keeps a stray geocode from shrinking the district into a corner', () => {
    const model = buildDistrictDots(
      [...grid(1_000), { lat: 10, lng: 10 }],
      SQUARE_VIEW_HEIGHT,
    )!
    const ys = model.dots.map((dot) => dot.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(50)
  })

  it('draws nothing from too few locations', () => {
    expect(buildDistrictDots(grid(50), SQUARE_VIEW_HEIGHT)).toBeNull()
    expect(buildDistrictDots([], SQUARE_VIEW_HEIGHT)).toBeNull()
  })
})

describe('buildAbstractDots', () => {
  it('draws a stand-in district with the same picks', () => {
    const model = buildAbstractDots(SQUARE_VIEW_HEIGHT)
    expect(model.abstract).toBe(true)
    expect(model.camera).toBeNull()
    expect(model.outline).toMatch(/^M/)
    expect(model.dots).toHaveLength(TARGET_DOTS)
    expect(model.dots.filter((dot) => dot.sample).length).toBeGreaterThan(0)
  })

  it('keeps the stand-in inside the wide phone frame', () => {
    const model = buildAbstractDots(WIDE_VIEW_HEIGHT)
    for (const dot of model.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0)
      expect(dot.x).toBeLessThanOrEqual(VIEW_WIDTH)
      expect(dot.y).toBeGreaterThanOrEqual(0)
      expect(dot.y).toBeLessThanOrEqual(WIDE_VIEW_HEIGHT)
    }
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
