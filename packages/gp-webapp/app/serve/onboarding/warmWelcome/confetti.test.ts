import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Matter from 'matter-js'
import { createConfetti, type Confetti } from './confetti'

// jsdom has no canvas, so the 2d context is a stand-in that records what was
// drawn, and animation frames are stepped by hand.
const fakeContext = () => ({
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  fillRect: vi.fn(),
  restore: vi.fn(),
  fillStyle: '',
})

const box = (top: number, height: number, left = 0, width = 1000): DOMRect =>
  ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

describe('createConfetti', () => {
  let context: ReturnType<typeof fakeContext>
  let canvas: HTMLCanvasElement
  let floor: HTMLElement
  let frames: FrameRequestCallback[]
  let clock: number
  let confetti: Confetti | null

  const step = (count: number): void => {
    for (let index = 0; index < count; index++) {
      const callback = frames.shift()
      if (!callback) return
      clock += 16
      callback(clock)
    }
  }

  const drawn = (): number => {
    const before = context.fillRect.mock.calls.length
    step(1)
    return context.fillRect.mock.calls.length - before
  }

  beforeEach(() => {
    context = fakeContext()
    frames = []
    clock = 1000
    canvas = document.createElement('canvas')
    canvas.getContext = vi.fn(
      () => context,
    ) as unknown as HTMLCanvasElement['getContext']
    canvas.getBoundingClientRect = () => box(0, 800)
    floor = document.createElement('footer')
    floor.getBoundingClientRect = () => box(720, 80)
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = []
    })
    confetti = createConfetti(Matter, canvas, () => floor)
  })

  afterEach(() => {
    confetti?.destroy()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('does nothing without a canvas to draw on', () => {
    const blank = document.createElement('canvas')
    blank.getContext = vi.fn(
      () => null,
    ) as unknown as HTMLCanvasElement['getContext']
    expect(createConfetti(Matter, blank, () => floor)).toBeNull()
  })

  it('pours a piece a frame for a few seconds, then stops adding', () => {
    confetti?.pour()
    step(10)
    expect(drawn()).toBe(11)
    // Past the pour, the count holds while the pieces fall and settle.
    clock += 3000
    const settled = drawn()
    expect(drawn()).toBe(settled)
  })

  it('lands pieces on the footer’s top edge instead of falling through', () => {
    confetti?.pour()
    step(600)
    const ys = context.translate.mock.calls.slice(-20).map(([, y]) => y)
    expect(Math.max(...ys)).toBeLessThanOrEqual(720)
    expect(Math.max(...ys)).toBeGreaterThan(600)
  })

  it('pops the asked number of pieces out of an element', () => {
    const icon = document.createElement('span')
    icon.getBoundingClientRect = () => box(400, 40, 480, 40)
    confetti?.burst(icon, 44)
    expect(drawn()).toBe(44)
    const [x, y] = context.translate.mock.calls[0] ?? []
    expect(x).toBeGreaterThan(460)
    expect(x).toBeLessThan(540)
    expect(y).toBeLessThan(430)
  })

  it('fades out and clears everything when a step is left', () => {
    vi.useFakeTimers()
    confetti?.pour()
    step(5)
    confetti?.clear()
    expect(canvas.style.opacity).toBe('0')
    vi.advanceTimersByTime(700)
    expect(frames).toHaveLength(0)
    expect(drawn()).toBe(0)
  })
})
