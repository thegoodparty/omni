import { afterEach, describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePinnedAutoScroll } from './usePinnedAutoScroll'

// jsdom leaves scrollHeight/clientHeight at 0, so define them; scrollTop is a
// real settable number. Here: 1000 tall, 400 visible -> bottom is scrollTop 600.
const makeEl = (scrollHeight: number, clientHeight: number): HTMLDivElement => {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight })
  return el
}

const setup = () => {
  const el = makeEl(1000, 400)
  const view = renderHook(
    ({ tick }: { tick: number }) => usePinnedAutoScroll([tick]),
    { initialProps: { tick: 0 } },
  )
  view.result.current.scrollRef.current = el
  return { el, ...view }
}

describe('usePinnedAutoScroll', () => {
  it('follows the bottom while pinned when deps change', () => {
    const { el, rerender } = setup()

    rerender({ tick: 1 })

    expect(el.scrollTop).toBe(1000)
  })

  it('stops following after a user scroll-up and resumes at the bottom', () => {
    const { el, result, rerender } = setup()
    rerender({ tick: 1 })

    // User scrolls up (position differs from our last write) -> unpins.
    el.scrollTop = 200
    result.current.onScroll()
    rerender({ tick: 2 })
    expect(el.scrollTop).toBe(200)

    // User scrolls back to the bottom (distance 0) -> re-pins.
    el.scrollTop = 600
    result.current.onScroll()
    rerender({ tick: 3 })
    expect(el.scrollTop).toBe(1000)
  })

  it('ignores its own programmatic scroll, staying pinned', () => {
    const { el, result, rerender } = setup()
    rerender({ tick: 1 })

    // The scroll event from our own write: scrollTop matches the last value we
    // set, so it must not be read as a user scroll-up.
    result.current.onScroll()
    rerender({ tick: 2 })
    expect(el.scrollTop).toBe(1000)
  })

  it('releases the pin when a user scroll lands between two follow-scrolls', () => {
    const { el, result, rerender } = setup()
    rerender({ tick: 1 })

    // Scroll events are coalesced and delivered at the end of the frame, so a
    // scroll-up mid-stream is followed by the next reveal tick's follow-scroll
    // BEFORE onScroll has reported anything. The follow-scroll must not clobber
    // the position the user just moved to.
    el.scrollTop = 200
    rerender({ tick: 2 })
    expect(el.scrollTop).toBe(200)

    // The user's scroll event lands late, and later ticks keep hands off.
    result.current.onScroll()
    rerender({ tick: 3 })
    expect(el.scrollTop).toBe(200)
  })

  it('brings the reply into view when the user sends, even after scrolling up', () => {
    const el = makeEl(1000, 400)
    const view = renderHook(
      ({ tick, sending }: { tick: number; sending: boolean }) =>
        usePinnedAutoScroll([tick], { sending }),
      { initialProps: { tick: 0, sending: false } },
    )
    view.result.current.scrollRef.current = el
    view.rerender({ tick: 1, sending: false })

    el.scrollTop = 200
    view.result.current.onScroll()
    view.rerender({ tick: 2, sending: false })
    expect(el.scrollTop).toBe(200)

    view.rerender({ tick: 2, sending: true })
    expect(el.scrollTop).toBe(1000)
    view.rerender({ tick: 3, sending: true })
    expect(el.scrollTop).toBe(1000)
  })

  describe('when the content grows on its own', () => {
    const observers: (() => void)[] = []
    afterEach(() => {
      observers.length = 0
      vi.unstubAllGlobals()
    })
    const stubResizeObserver = () =>
      vi.stubGlobal(
        'ResizeObserver',
        vi.fn(function ResizeObserver(callback: () => void) {
          observers.push(callback)
          return { observe: vi.fn(), disconnect: vi.fn() }
        }),
      )

    it('keeps a pinned view at the bottom', () => {
      stubResizeObserver()
      let height = 1000
      const el = document.createElement('div')
      Object.defineProperty(el, 'scrollHeight', { get: () => height })
      Object.defineProperty(el, 'clientHeight', { value: 400 })
      const view = renderHook(
        ({ tick }: { tick: number }) => usePinnedAutoScroll([tick]),
        { initialProps: { tick: 0 } },
      )
      view.result.current.scrollRef.current = el
      view.rerender({ tick: 1 })
      expect(el.scrollTop).toBe(1000)

      // A draft card finishes laying out below the fold: no dep changes.
      height = 1600
      observers.forEach((callback) => callback())
      expect(el.scrollTop).toBe(1600)
    })

    it('leaves a reader who scrolled up where they are', () => {
      stubResizeObserver()
      let height = 1000
      const el = document.createElement('div')
      Object.defineProperty(el, 'scrollHeight', { get: () => height })
      Object.defineProperty(el, 'clientHeight', { value: 400 })
      const view = renderHook(
        ({ tick }: { tick: number }) => usePinnedAutoScroll([tick]),
        { initialProps: { tick: 0 } },
      )
      view.result.current.scrollRef.current = el
      view.rerender({ tick: 1 })
      el.scrollTop = 200
      view.result.current.onScroll()

      height = 1600
      observers.forEach((callback) => callback())
      expect(el.scrollTop).toBe(200)
    })
  })
})
