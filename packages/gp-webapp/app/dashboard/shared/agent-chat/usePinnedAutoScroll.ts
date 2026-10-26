'use client'

import { useCallback, useEffect, useRef, type RefObject } from 'react'

// Pin a scroll container to the bottom as content streams in, releasing when
// the user scrolls up to read and resuming when they return to the bottom.
//
// It reads scroll POSITION rather than input events, so it releases for every
// input method — wheel, touch, keyboard (PageUp/arrows), and scrollbar drag —
// not just the ones that emit a wheel/touch event. The container's own
// auto-scroll write is ignored by comparing scrollTop against the value we last
// set, so an in-flight follow-scroll never gets misread as a user scroll-up.
//
// Pass the streaming/message signals as `deps` so the follow-scroll runs as they
// change (instant, not smooth — a smooth scroll would restart its animation on
// every ~40x/s reveal tick and jitter).
//
// `sending` re-pins when the user sends: their own message means they are
// done reading above, so the reply that starts next is brought into view. A
// resize of the container or its content (a card growing after it renders,
// a phone keyboard closing) keeps a pinned view at the bottom instead of
// reading the moved bottom as a scroll-up.
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

  const stick = useCallback((el: HTMLDivElement) => {
    el.scrollTop = el.scrollHeight
    lastAutoTopRef.current = el.scrollTop
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Ignore the scroll our own follow-scroll produced (the scrollTop we just
    // set); only a user scroll to a different position toggles the pin.
    if (Math.abs(el.scrollTop - lastAutoTopRef.current) < 1) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4
  }, [])

  useEffect(() => {
    if (!sending) return
    pinnedRef.current = true
    const el = scrollRef.current
    if (el) stick(el)
  }, [sending, stick])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) stick(el)
    })
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pinnedRef.current) return
    // Re-check the position before writing, not just in `onScroll`. Scroll
    // events are coalesced and delivered at the end of a frame, so a user
    // scroll-up can land, get clobbered by the next reveal tick's write (they
    // run every 24ms), and only then be reported — at which point scrollTop is
    // back at the bottom and reads as our own write. Growing content doesn't
    // move scrollTop, so a value other than the one we last set means the user
    // moved it: release rather than yank them back down.
    if (
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
