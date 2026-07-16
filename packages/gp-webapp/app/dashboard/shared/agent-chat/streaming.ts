import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessageSegment } from './chatClient'

// A live assistant turn as interleaved blocks: streamed text and tool-call
// pills in the order they arrived. Shared by every agent-chat scope so the
// streaming/reveal behavior is one implementation (Chief of Staff, ordinance
// flow, ...). Feature-specific structured widgets stay in the scope and render
// after the reached segment.
export type LiveSegment =
  | { kind: 'text'; text: string }
  // `running` shimmers the pill while the tool is in flight (set on tool_call,
  // cleared on tool_result). Absent on persisted history, so reloaded pills are
  // always static.
  | { kind: 'tool'; toolName: string; running?: boolean }

// Project a persisted assistant message into interleaved LiveSegments, so a
// reloaded turn renders identically to how it streamed: stored segments in order
// (dropping empty text), falling back to a bare `content` string for legacy rows
// with no segments. Shared by every agent-chat scope.
export function segmentsToLive(
  segments: ChatMessageSegment[],
  content: string,
): LiveSegment[] {
  return segments.length > 0
    ? segments.flatMap((s): LiveSegment[] =>
        s.kind === 'text'
          ? s.text
            ? [{ kind: 'text', text: s.text }]
            : []
          : s.toolName
            ? [{ kind: 'tool', toolName: s.toolName }]
            : [],
      )
    : content
      ? [{ kind: 'text', text: content }]
      : []
}

// Revealed-able characters in a turn (text only; pills reveal with the text
// before them).
export function segmentsTextLength(segments: LiveSegment[]): number {
  return segments.reduce(
    (n, s) => (s.kind === 'text' ? n + s.text.length : n),
    0,
  )
}

// Slice segments to a revealed character budget. A partially-revealed text
// block hides everything after it, so a tool pill never appears ahead of the
// text that precedes it.
export function sliceRevealed(
  segments: LiveSegment[],
  revealed: number,
): LiveSegment[] {
  let budget = revealed
  const out: LiveSegment[] = []
  for (const seg of segments) {
    if (seg.kind !== 'text') {
      out.push(seg)
      continue
    }
    if (budget < seg.text.length) {
      if (budget > 0)
        out.push({ kind: 'text', text: seg.text.slice(0, budget) })
      return out
    }
    out.push(seg)
    budget -= seg.text.length
  }
  return out
}

// Smooth playback for a streamed turn: a character counter ticks toward the
// text that has actually arrived, with a backlog-scaled step so the reveal
// trails the network by a bounded amount and drains quickly after `done`. This
// replaces per-SSE-chunk rendering (which jumps in multi-word blocks) with a
// steady type-out. Returns the visible (revealed-sliced) segments plus a live
// ref to the revealed count, so the caller can hold the history commit until
// the reveal drains (the tail types out instead of snapping in on the swap).
export function useSmoothReveal(
  segments: LiveSegment[],
  active: boolean,
): {
  visibleSegments: LiveSegment[]
  revealedRef: React.MutableRefObject<number>
} {
  const [revealed, setRevealed] = useState(0)
  const revealedRef = useRef(0)
  const segmentsRef = useRef(segments)
  const lastTickRef = useRef<number | null>(null)

  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  useEffect(() => {
    if (!active) {
      setRevealed(0)
      revealedRef.current = 0
      lastTickRef.current = null
      return
    }
    const id = setInterval(() => {
      setRevealed((r) => {
        const total = segmentsTextLength(segmentsRef.current)
        if (r >= total) {
          lastTickRef.current = null
          return r
        }
        // Pace the reveal by elapsed wall-clock, not by how many times this
        // timer fires. Browsers throttle setInterval to ~1s in a hidden or
        // backgrounded tab; keying the step to tick count alone made the
        // type-out (and everything gated behind it — the next-step button,
        // widgets, the commit to history) run ~40x slower there, trailing a
        // finished stream by tens of seconds. Applying one step per elapsed
        // 24ms frame keeps the foreground feel identical (one frame per tick)
        // while a throttled tick catches up the frames it slept through.
        const now = Date.now()
        const frames = Math.min(
          total,
          Math.max(1, Math.round((now - (lastTickRef.current ?? now)) / 24)),
        )
        lastTickRef.current = now
        let next = r
        for (let i = 0; i < frames && next < total; i++) {
          next = Math.min(
            total,
            next + Math.max(2, Math.ceil((total - next) / 50)),
          )
        }
        revealedRef.current = next
        return next
      })
    }, 24)
    return () => clearInterval(id)
  }, [active])

  const visibleSegments = useMemo(
    () => sliceRevealed(segments, revealed),
    [segments, revealed],
  )
  return { visibleSegments, revealedRef }
}
