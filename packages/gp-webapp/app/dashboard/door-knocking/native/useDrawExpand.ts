import { useCallback, useRef } from 'react'

// Long enough to read as one motion, short enough that a candidate opening
// the map five times in an evening never waits for it.
const DURATION_MS = 280
// Fast out, settle in — the map arrives quickly and eases to rest, rather
// than drifting for the first half of the gesture.
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'
// The preview card's own corner, so the shape that grows is the shape that
// was pressed.
const START_RADIUS_PX = 12

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// The pressed rectangle, expressed as insets into the map region — which is
// what `clip-path` wants, and what makes the map appear to grow out of the
// card rather than fade in over it. Clamped at zero because the card can sit
// partly outside the region (the flow's sheet is not inside the map column),
// and a negative inset would expand the clip beyond the element.
const insetFromOrigin = (origin: DOMRect, host: DOMRect): string =>
  `inset(${Math.max(0, origin.top - host.top)}px ${Math.max(
    0,
    host.right - origin.right,
  )}px ${Math.max(0, host.bottom - origin.bottom)}px ${Math.max(
    0,
    origin.left - host.left,
  )}px round ${START_RADIUS_PX}px)`

interface DrawExpand {
  // Goes on the element that should appear to grow: the row holding the map
  // column and the turf panel.
  hostRef: React.RefObject<HTMLDivElement | null>
  // Opening. Takes the rectangle that was pressed.
  expand: (origin: DOMRect) => void
  // Closing. Runs the reverse and calls `done` when the map has shrunk back
  // into the card — the caller uses that to put the flow's sheet back, so
  // the sheet does not cover the animation it is the destination of.
  collapse: (done: () => void) => void
}

// The drawing surface opening out of the draw step's preview card, and
// folding back into it.
//
// Clip-path rather than a transform or a width/height: the map is a WebGL
// canvas with maplibre's own `ResizeObserver` on it, so animating its box
// would drive a resize every frame and re-render the whole scene ~17 times
// for one gesture. A clip leaves the canvas at full size and untouched, runs
// on the compositor, and costs the map nothing. It also means the pixels
// revealed are the real map at its real scale the entire way, where a scale
// transform would show it blurred and mis-zoomed until it landed.
//
// The Web Animations API rather than a Tailwind keyframe, because the start
// geometry is only known at the moment of the press — it is the card's
// position on screen, which moves with the scroll and the breakpoint.
//
// `prefers-reduced-motion` skips the whole thing and reports done
// immediately, so the surface still opens and closes; only the travel goes.
export const useDrawExpand = (): DrawExpand => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const originRef = useRef<DOMRect | null>(null)

  const run = useCallback((reverse: boolean, done?: () => void) => {
    const host = hostRef.current
    const origin = originRef.current
    // No origin means the surface was opened by something other than the
    // card — nothing to grow out of, so it simply appears.
    // `animate` is guarded as well as the rect: jsdom has neither, and the
    // surface must still open and close under test. A hidden tab is guarded
    // too, for the reason the settle below exists.
    if (
      !host ||
      !origin ||
      typeof host.animate !== 'function' ||
      document.hidden ||
      prefersReducedMotion()
    ) {
      done?.()
      return
    }
    const hostRect = host.getBoundingClientRect()
    if (hostRect.width === 0 || hostRect.height === 0) {
      done?.()
      return
    }
    const closed: Keyframe = {
      clipPath: insetFromOrigin(origin, hostRect),
      opacity: 0.4,
    }
    const opened: Keyframe = { clipPath: 'inset(0px round 0px)', opacity: 1 }
    const animation = host.animate(
      reverse ? [opened, closed] : [closed, opened],
      {
        duration: DURATION_MS,
        easing: EASING,
        // Closing holds the final frame, so the map stays folded up while the
        // caller brings the sheet back over it. Opening needs no fill — its
        // final frame is the element's own resting state.
        fill: reverse ? 'forwards' : 'none',
      },
    )

    // The clip is released by US, not by the animation ending.
    //
    // A backgrounded tab suspends the animation clock outright: `playState`
    // stays "running", `currentTime` freezes wherever it got to, `onfinish`
    // never arrives — and the frame it froze on keeps applying. Switching
    // tabs during these 280ms would otherwise leave the map permanently
    // clipped to part of the screen, which is exactly what happened the
    // first time this was driven from an automated browser. So there are
    // three ways out and the first one wins: the animation finishing, the
    // tab being hidden, or a deadline.
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      window.clearTimeout(deadline)
      document.removeEventListener('visibilitychange', settle)
      done?.()
      if (reverse) {
        // Released a frame after the sheet is back, not before: dropping the
        // clip in the same tick shows the full map for one frame behind a
        // sheet that has not painted yet.
        requestAnimationFrame(() => animation.cancel())
        return
      }
      animation.cancel()
    }
    animation.onfinish = settle
    document.addEventListener('visibilitychange', settle)
    const deadline = window.setTimeout(settle, DURATION_MS + 120)
  }, [])

  return {
    hostRef,
    expand: useCallback(
      (origin: DOMRect) => {
        originRef.current = origin
        // After the surface has mounted and the sheet has gone, so the first
        // frame of the animation is the map and not the sheet on top of it.
        requestAnimationFrame(() => run(false))
      },
      [run],
    ),
    collapse: useCallback((done: () => void) => run(true, done), [run]),
  }
}
