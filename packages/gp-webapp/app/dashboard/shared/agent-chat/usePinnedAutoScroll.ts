'use client'

import { useCallback, useEffect, useRef, type RefObject } from 'react'

// How long after a wheel, touch, key or pointer press a scroll still counts as
// the user's. Momentum scrolling keeps emitting scroll events after the last
// touch, so this has to outlast a fling, not just one frame.
const USER_SCROLL_WINDOW_MS = 1000

// Pin a scroll container to the bottom as content streams in, releasing when
// the user scrolls up to read and resuming when they return to the bottom.
//
// Only a scroll the user made can release the pin. The browser moves scrollTop
// on its own too: it clamps it when content shrinks (a thinking row or a live
// turn swapping for its committed copy) and shifts it for scroll anchoring.
// Read as a user scroll-up, those left the view stuck 100px or more above the
// bottom once the next card, option list or feedback row rendered. So a
// position change unpins only right after a wheel, touch, key or pointer press
// (a pointer press on the scrollbar counts, so a drag still releases), and
// scroll anchoring is off for the container since this hook does that job.
//
// Pass the streaming/message signals as `deps` so the follow-scroll runs as they
// change (instant, not smooth — a smooth scroll would restart its animation on
// every ~40x/s reveal tick and jitter).
//
// `sending` re-pins when the user sends: their own message means they are
// done reading above, so the reply that starts next is brought into view. A
// resize of the container or its content (a card growing after it renders,
// a phone keyboard closing), and a row added or removed without any dep
// changing (a thinking row, an error), keep a pinned view at the bottom.
export function usePinnedAutoScroll(
  deps: readonly unknown[],
  { sending = false }: { sending?: boolean } = {},
): {
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
} {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const lastAutoTopRef = useRef(0)
  const lastUserInputRef = useRef(Number.NEGATIVE_INFINITY)
  const pointerDownRef = useRef(false)

  const stick = useCallback((el: HTMLDivElement) => {
    el.scrollTop = el.scrollHeight
    lastAutoTopRef.current = el.scrollTop
  }, [])

  const userIsScrolling = () =>
    pointerDownRef.current ||
    performance.now() - lastUserInputRef.current < USER_SCROLL_WINDOW_MS

  useEffect(() => {
    const inside = (event: Event) => {
      const el = scrollRef.current
      return Boolean(
        el && event.target instanceof Node && el.contains(event.target),
      )
    }
    const markInside = (event: Event) => {
      if (inside(event)) lastUserInputRef.current = performance.now()
    }
    const markKey = () => {
      lastUserInputRef.current = performance.now()
    }
    const pointerDown = (event: Event) => {
      if (!inside(event)) return
      pointerDownRef.current = true
      lastUserInputRef.current = performance.now()
    }
    const pointerUp = () => {
      if (!pointerDownRef.current) return
      pointerDownRef.current = false
      lastUserInputRef.current = performance.now()
    }
    const options = { capture: true, passive: true }
    window.addEventListener('wheel', markInside, options)
    window.addEventListener('touchstart', markInside, options)
    window.addEventListener('touchmove', markInside, options)
    window.addEventListener('keydown', markKey, options)
    window.addEventListener('pointerdown', pointerDown, options)
    window.addEventListener('pointerup', pointerUp, options)
    window.addEventListener('pointercancel', pointerUp, options)
    return () => {
      window.removeEventListener('wheel', markInside, options)
      window.removeEventListener('touchstart', markInside, options)
      window.removeEventListener('touchmove', markInside, options)
      window.removeEventListener('keydown', markKey, options)
      window.removeEventListener('pointerdown', pointerDown, options)
      window.removeEventListener('pointerup', pointerUp, options)
      window.removeEventListener('pointercancel', pointerUp, options)
    }
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Ignore the scroll our own follow-scroll produced (the scrollTop we just
    // set); only a user scroll to a different position toggles the pin.
    if (Math.abs(el.scrollTop - lastAutoTopRef.current) < 1) return
    if (!userIsScrolling()) {
      if (pinnedRef.current) stick(el)
      return
    }
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
  }, [stick])

  useEffect(() => {
    if (!sending) return
    pinnedRef.current = true
    const el = scrollRef.current
    if (el) stick(el)
  }, [sending, stick])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.style.overflowAnchor = 'none'
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (pinnedRef.current) stick(el)
          })
    resize?.observe(el)
    for (const child of Array.from(el.children)) resize?.observe(child)
    const mutation =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((records) => {
            for (const record of records) {
              for (const node of Array.from(record.addedNodes)) {
                if (node instanceof Element && node.parentElement === el) {
                  resize?.observe(node)
                }
              }
            }
            if (pinnedRef.current) stick(el)
          })
    mutation?.observe(el, { childList: true, subtree: true })
    return () => {
      resize?.disconnect()
      mutation?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pinnedRef.current) return
    // Re-check the position before writing, not just in `onScroll`. Scroll
    // events are coalesced and delivered at the end of a frame, so a user
    // scroll-up can land, get clobbered by the next reveal tick's write (they
    // run every 24ms), and only then be reported — at which point scrollTop is
    // back at the bottom and reads as our own write. Only a scroll the user
    // just made counts: the browser's own clamp after content shrinks also
    // moves scrollTop, and must not release the pin.
    if (
      userIsScrolling() &&
      Math.abs(el.scrollTop - lastAutoTopRef.current) >= 1 &&
      el.scrollHeight - el.scrollTop - el.clientHeight >= 4
    ) {
      pinnedRef.current = false
      return
    }
    stick(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { scrollRef, onScroll }
}
