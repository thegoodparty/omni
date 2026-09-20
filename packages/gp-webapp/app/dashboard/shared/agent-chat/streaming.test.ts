// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  type LiveSegment,
  segmentsTextLength,
  segmentsToLive,
  sliceRevealed,
  useSmoothReveal,
} from './streaming'
import type { ChatMessageSegment } from './chatTypes'

// ---------------------------------------------------------------------------
// segmentsToLive
// ---------------------------------------------------------------------------

describe('segmentsToLive', () => {
  it('falls back to a single text segment when segments array is empty', () => {
    const result = segmentsToLive([], 'hello world')
    expect(result).toEqual([{ kind: 'text', text: 'hello world' }])
  })

  it('returns empty array when segments is empty and content is empty', () => {
    expect(segmentsToLive([], '')).toEqual([])
  })

  it('assigns 1-based ordinals to citation segments in stream order', () => {
    const segments: ChatMessageSegment[] = [
      { kind: 'citation', attachmentId: 'att-1', page: 3, quotedText: 'foo' },
      { kind: 'citation', attachmentId: 'att-2', page: null, quotedText: null },
    ]
    const result = segmentsToLive(segments, '')
    expect(result).toEqual([
      {
        kind: 'citation',
        ordinal: 1,
        attachmentId: 'att-1',
        page: 3,
        quotedText: 'foo',
      },
      {
        kind: 'citation',
        ordinal: 2,
        attachmentId: 'att-2',
        page: null,
        quotedText: null,
      },
    ])
  })

  it('interleaves text and citation segments in segment order', () => {
    const segments: ChatMessageSegment[] = [
      { kind: 'text', text: 'Before ' },
      { kind: 'citation', attachmentId: 'att-1', page: 1, quotedText: 'q' },
      { kind: 'text', text: ' after' },
    ]
    const result = segmentsToLive(segments, '')
    expect(result).toEqual([
      { kind: 'text', text: 'Before ' },
      {
        kind: 'citation',
        ordinal: 1,
        attachmentId: 'att-1',
        page: 1,
        quotedText: 'q',
      },
      { kind: 'text', text: ' after' },
    ])
  })

  it('skips citation segments with no attachmentId', () => {
    const segments: ChatMessageSegment[] = [
      { kind: 'citation', attachmentId: null, page: null, quotedText: null },
      { kind: 'citation', attachmentId: 'att-1', page: null, quotedText: null },
    ]
    const result = segmentsToLive(segments, '')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'citation',
      ordinal: 1,
      attachmentId: 'att-1',
    })
  })

  it('resets ordinal counter independently per call', () => {
    const segments: ChatMessageSegment[] = [
      { kind: 'citation', attachmentId: 'att-a', page: null, quotedText: null },
    ]
    const first = segmentsToLive(segments, '')
    const second = segmentsToLive(segments, '')
    expect((first[0] as { ordinal: number }).ordinal).toBe(1)
    expect((second[0] as { ordinal: number }).ordinal).toBe(1)
  })
})

// The reveal must be paced by WALL-CLOCK, not by how often its timer fires.
// Browsers throttle setInterval to ~1s in a hidden/backgrounded tab (measured
// live: ~1040ms vs the 24ms the reveal requests). If the reveal advanced a
// fixed slice per tick, a hidden tab would type out ~40x slower and trail a
// finished stream by tens of seconds. These tests pin the invariant using fake
// timers, with setInterval clamped to model the two tab states.

const TURN: LiveSegment[] = [
  {
    kind: 'text',
    text: 'The ban is locked in for all residential zones year-round. '.repeat(
      45,
    ),
  },
]
const TOTAL = segmentsTextLength(TURN)

const FOREGROUND_TICK_MS = 24
const HIDDEN_TAB_TICK_MS = 1000

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Drive the hook under fake timers with setInterval clamped to `tickMs` (a
// hidden tab fires ~1x/s no matter the requested delay), advance `wallMs` of
// wall-clock, and report how many characters were revealed. Fake timers also
// fake Date, so the hook's elapsed-time math sees the same advancing clock.
const revealedAfter = (
  segments: LiveSegment[],
  wallMs: number,
  tickMs: number,
): number => {
  vi.useFakeTimers()
  const fakeSetInterval = globalThis.setInterval
  vi.stubGlobal(
    'setInterval',
    (fn: TimerHandler, _delay?: number, ...args: unknown[]) =>
      (fakeSetInterval as typeof setInterval)(fn, tickMs, ...args),
  )
  const { result, unmount } = renderHook(() => useSmoothReveal(segments, true))
  act(() => {
    vi.advanceTimersByTime(wallMs)
  })
  const revealed = result.current.revealedRef.current
  unmount()
  return revealed
}

describe('useSmoothReveal — paced by wall-clock, not tick count', () => {
  it('a plain render shows the full turn immediately (the content is always available)', () => {
    expect(segmentsTextLength(sliceRevealed(TURN, TOTAL))).toBe(TOTAL)
  })

  it('foreground tab (24ms ticks): drains the whole turn within a few seconds', () => {
    expect(revealedAfter(TURN, 8_000, FOREGROUND_TICK_MS)).toBe(TOTAL)
  })

  it('reveals ~the same amount for equal wall-clock, regardless of tick cadence', () => {
    const wallMs = 8_000
    const foreground = revealedAfter(TURN, wallMs, FOREGROUND_TICK_MS)
    const hidden = revealedAfter(TURN, wallMs, HIDDEN_TAB_TICK_MS)
    // Same wall-clock elapsed ⇒ same progress (pre-fix the hidden tab lagged
    // ~40x and this was ~399 vs ~2655).
    expect(hidden).toBeGreaterThanOrEqual(foreground * 0.9)
  })

  it('a finished turn fully reveals within ~5s even in a hidden/throttled tab', () => {
    expect(
      revealedAfter(TURN, 5_000, HIDDEN_TAB_TICK_MS),
    ).toBeGreaterThanOrEqual(TOTAL * 0.9)
  })
})
