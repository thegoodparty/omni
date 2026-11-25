import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cameraAnchorY,
  createVoiceTour,
  legBump,
  projectPlace,
  TOUR_OPEN_ZOOM,
  TOUR_STREET_ZOOM,
  worldPoint,
  type TourCamera,
  type TourView,
} from './voiceTour'

const A = { lat: 42.3251, lon: -72.6412 }
const B = { lat: 42.3176, lon: -72.6311 }
const FAR = { lat: 42.45, lon: -72.5 }
const HOME = { lat: 42.32, lon: -72.636 }

describe('the map math', () => {
  it('puts the equator and the prime meridian in the middle of the world', () => {
    expect(worldPoint({ lat: 0, lon: 0 })).toEqual({ x: 128, y: 128 })
  })

  it('draws the camera’s own place 40px above the middle', () => {
    const size = { width: 680, height: 300 }
    const at = projectPlace(A, { ...A, zoom: TOUR_STREET_ZOOM }, size)
    expect(at.x).toBeCloseTo(340)
    expect(at.y).toBeCloseTo(cameraAnchorY(300))
    expect(cameraAnchorY(300)).toBe(110)
    expect(at.scale).toBe(1)
    expect(at.opacity).toBe(1)
  })

  it('never puts the place so high that its zone is cut off', () => {
    expect(cameraAnchorY(170)).toBe(64)
  })

  it('hides the zones while the camera is wide', () => {
    const at = projectPlace(
      A,
      { ...HOME, zoom: TOUR_OPEN_ZOOM },
      { width: 680, height: 300 },
    )
    expect(at.opacity).toBe(0)
    expect(at.scale).toBeLessThan(0.05)
  })

  it('pans straight between near places and lifts between far ones', () => {
    expect(legBump(A, B)).toBe(0)
    expect(legBump(A, FAR)).toBeGreaterThan(0.5)
    expect(legBump(A, { lat: 44, lon: -70 })).toBe(2.6)
  })
})

describe('createVoiceTour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const tourOf = (places = [A, B]) => {
    const views: TourView[] = []
    const cameras: TourCamera[] = []
    const tour = createVoiceTour({
      places,
      home: HOME,
      // The camera cuts, so the test does not depend on frames.
      animate: false,
      onCamera: (camera) => cameras.push({ ...camera }),
      onView: (view) => views.push(view),
    })
    return { tour, views, cameras, last: () => views.at(-1) }
  }

  it('opens wide over the district with no comment up', () => {
    const { tour, cameras, last } = tourOf()
    tour.start(900)
    expect(cameras[0]).toEqual({ ...HOME, zoom: TOUR_OPEN_ZOOM })
    expect(last()).toMatchObject({ up: false, live: -1 })
    tour.stop()
  })

  it('goes to the first place, then brings its comment up', () => {
    const { tour, cameras, last } = tourOf()
    tour.start(900)
    vi.advanceTimersByTime(900)
    expect(last()).toMatchObject({ live: 0, up: false })
    expect(cameras.at(-1)).toEqual({ ...A, zoom: TOUR_STREET_ZOOM })
    vi.advanceTimersByTime(150)
    expect(last()).toMatchObject({ index: 0, up: true })
    tour.stop()
  })

  it('moves on by itself and wraps around', () => {
    const { tour, last } = tourOf()
    tour.start(0)
    vi.advanceTimersByTime(200)
    expect(last()).toMatchObject({ index: 0, up: true })
    vi.advanceTimersByTime(2800 - 2000 + 8700)
    expect(last()).toMatchObject({ live: 1 })
    vi.advanceTimersByTime(150)
    expect(last()).toMatchObject({ index: 1, up: true })
    vi.advanceTimersByTime(8700 + 150)
    expect(last()).toMatchObject({ index: 0, up: true })
    tour.stop()
  })

  it('steps either way from the chevrons', () => {
    const { tour, last } = tourOf([A, B, FAR])
    tour.start(0)
    vi.advanceTimersByTime(200)
    tour.go(-1)
    vi.advanceTimersByTime(200)
    expect(last()).toMatchObject({ index: 2, up: true })
    tour.go(1)
    vi.advanceTimersByTime(200)
    expect(last()).toMatchObject({ index: 0, up: true })
    tour.stop()
  })

  it('holds a comment while the pointer is over the map', () => {
    const { tour, last } = tourOf()
    tour.start(0)
    vi.advanceTimersByTime(200)
    tour.hover(true)
    expect(last()).toMatchObject({ paused: true, index: 0 })
    vi.advanceTimersByTime(60_000)
    expect(last()).toMatchObject({ paused: true, index: 0, up: true })
    tour.hover(false)
    expect(last()).toMatchObject({ paused: false })
    vi.advanceTimersByTime(10_000)
    expect(last()).toMatchObject({ index: 1 })
    tour.stop()
  })

  it('does nothing with no places, and stops when told', () => {
    const empty = tourOf([])
    empty.tour.start(0)
    vi.advanceTimersByTime(20_000)
    expect(empty.views).toEqual([])

    const { tour, views } = tourOf()
    tour.start(0)
    vi.advanceTimersByTime(200)
    tour.stop()
    const seen = views.length
    vi.advanceTimersByTime(60_000)
    expect(views).toHaveLength(seen)
  })
})
