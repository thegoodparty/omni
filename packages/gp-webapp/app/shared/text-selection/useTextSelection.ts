'use client'

import { useEffect, useState, type RefObject } from 'react'

export type TextSelection = {
  text: string
  rect: DOMRect
}

// Tracks the current text selection when it falls inside `containerRef`.
// Returns null when there's no (non-empty) selection or it's outside the
// container. Used to drive a floating "Ask AI" popover, mirroring the
// meeting-briefings highlight experience (without note persistence).
export const useTextSelection = (
  containerRef: RefObject<HTMLElement | null>,
): TextSelection | null => {
  const [selection, setSelection] = useState<TextSelection | null>(null)

  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null)
        return
      }
      const text = sel.toString().trim()
      const container = containerRef.current
      const range = sel.getRangeAt(0)
      if (
        !text ||
        !container ||
        !container.contains(range.commonAncestorContainer)
      ) {
        setSelection(null)
        return
      }
      setSelection({ text, rect: range.getBoundingClientRect() })
    }

    // The popover is positioned from a viewport-relative rect, so a scroll
    // would leave it drifting away from the text. Dismiss on scroll instead.
    const clearOnScroll = () => setSelection(null)

    // selectionchange fires continuously mid-drag on some browsers; also
    // settle on mouseup/keyup so the popover anchors to the final selection,
    // matching the briefings highlight hook (app/shared/briefings/use-selection).
    document.addEventListener('selectionchange', handler)
    document.addEventListener('mouseup', handler)
    document.addEventListener('keyup', handler)
    window.addEventListener('scroll', clearOnScroll, {
      capture: true,
      passive: true,
    })
    return () => {
      document.removeEventListener('selectionchange', handler)
      document.removeEventListener('mouseup', handler)
      document.removeEventListener('keyup', handler)
      window.removeEventListener('scroll', clearOnScroll, { capture: true })
    }
  }, [containerRef])

  return selection
}
