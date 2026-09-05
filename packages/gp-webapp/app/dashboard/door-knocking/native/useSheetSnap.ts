'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// The three resting heights the design gives every bottom sheet over this map,
// in its order. `peek` has no percentage — it is the grip and the header row
// and nothing else, so it is whatever that content measures.
export type SheetSnap = 'peek' | 'half' | 'full'

const SNAP_ORDER: SheetSnap[] = ['peek', 'half', 'full']
// A drag has to travel this far before it counts as a snap change; anything
// shorter is a tap, and a tap cycles.
const DRAG_THRESHOLD_PX = 40
// A drag has to travel this far before it stops being a tap at all. Below it a
// pointer that wandered a couple of pixels under a thumb still opens the sheet.
const TAP_SLOP_PX = 6
// Between the top of the sheet and the bottom of the map's control cluster.
const CONTROLS_GAP_PX = 12

// The grip's behaviour, shared by the manage rail and the walk because the two
// sheets are the same object at two moments and a canvasser who learns the
// gesture on one has learned it on the other. Drag up or down to move one snap;
// tap to cycle.
//
// It also reports how far up the map it currently reaches, because the zoom
// cluster has to clear it and only the sheet knows its own height — `peek` is a
// content height, and the header it is made of changes with what is in it. The
// report is `null` at `full`, which leaves no map to zoom.
export const useSheetSnap = (initial: SheetSnap = 'half') => {
  const [snap, setSnap] = useState<SheetSnap>(initial)
  const sheetRef = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragMoved = useRef(false)

  const cycle = useCallback(
    () =>
      setSnap(
        (current) =>
          SNAP_ORDER[(SNAP_ORDER.indexOf(current) + 1) % SNAP_ORDER.length] ??
          'half',
      ),
    [],
  )

  const gripHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      dragStartY.current = event.clientY
      dragMoved.current = false
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (dragStartY.current === null) return
      if (Math.abs(event.clientY - dragStartY.current) > TAP_SLOP_PX)
        dragMoved.current = true
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const from = dragStartY.current
      dragStartY.current = null
      if (from === null) return
      // A stationary press does nothing. This used to tap-to-cycle through
      // the three snaps and silently produced unwanted resizes — a canvasser
      // resting a thumb on the header (the only place they could hold the
      // sheet) or a keyboard user reaching for the Exit button would land
      // a click and the sheet would move under them. Keyboard cycling
      // (Enter/Space on the grip's role="button") stays intentional and
      // still calls `cycle()`.
      if (!dragMoved.current) return
      const delta = event.clientY - from
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return
      setSnap((current) => {
        const index = SNAP_ORDER.indexOf(current)
        const next = delta < 0 ? index + 1 : index - 1
        return (
          SNAP_ORDER[Math.max(0, Math.min(SNAP_ORDER.length - 1, next))] ??
          current
        )
      })
    },
  }

  const heightClass =
    snap === 'full' ? 'h-[92dvh]' : snap === 'half' ? 'h-[50dvh]' : 'h-auto'

  return { snap, setSnap, cycle, gripHandlers, heightClass, sheetRef }
}

// The other half: telling whoever draws the map controls where this sheet ends.
// Split out because the manage rail is a top-left card above `lg` and covers
// nothing there, while the walk's sheet covers the map at every width — so the
// two ask the same question with different answers and only the caller knows
// which.
export const useSheetControlsOffset = (
  sheetRef: React.MutableRefObject<HTMLElement | null>,
  snap: SheetSnap,
  report: ((offsetPx: number | null) => void) | undefined,
  // `null` withdraws the cluster outright (an empty state's scrim, a sheet at
  // full); a number overrides the measurement (the desktop rail's 16px edge).
  override: number | null | undefined,
) => {
  const measure = useCallback(() => {
    if (!report) return
    if (override !== undefined) {
      report(override)
      return
    }
    if (snap === 'full') {
      report(null)
      return
    }
    const sheet = sheetRef.current
    report(sheet ? sheet.offsetHeight + CONTROLS_GAP_PX : 16)
  }, [report, override, snap, sheetRef])

  useEffect(() => {
    measure()
    const sheet = sheetRef.current
    window.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined' || !sheet) {
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(sheet)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, sheetRef])

  // The surface is unmounted on the way out of this mode, and the offset is
  // this surface's fact — so it is withdrawn rather than left pointing at a
  // sheet that no longer exists.
  useEffect(() => () => report?.(16), [report])
}
