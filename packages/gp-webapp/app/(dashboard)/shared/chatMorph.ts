// The chat box on Home and the Chat pill in the sidebar are one thing in two
// places. Leaving Home, the box shrinks into the pill; coming back, it grows
// out of it, so the candidate sees where the chat went instead of losing it.
// Asked for by product as a genie-style handoff. A true genie warps the shape,
// which the web can't do natively, so this squeezes the width first and then
// the height while it travels, which reads the same at a glance.
//
// Both ends are found by data attribute because they live in different
// components (HomeComposer and DashboardMenu). Nothing runs when either end is
// missing or hidden (the sidebar is a drawer on a phone), or when the viewer
// asks for reduced motion.

const COMPOSER = '[data-chat-morph="composer"]'
const PILL = '[data-chat-morph="pill"]'
const ARRIVING_KEY = 'chat-morph-arriving'
// The arrival mark lasts until a grow-in finishes, not until it is first read:
// Home can mount more than once on arrival (React's dev double mount, a
// remount as data lands), and a one-shot would be spent on a box that never
// reaches the screen. This only backstops a mark whose Home never rendered.
const ARRIVING_EXPIRES_MS = 10_000
// How long Home's box waits, hidden, for the sidebar's pill to render.
const PILL_WAIT_MS = 400

const DURATION_OUT_MS = 450
const DURATION_IN_MS = 380
// Ease in going away (pulled into the sidebar), ease out coming back.
const EASE_IN = 'cubic-bezier(0.55, 0, 0.75, 0.25)'
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.3, 1)'

const prefersReducedMotion = (): boolean =>
  typeof window === 'undefined' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const visibleRect = (selector: string): DOMRect | null => {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

// The transform that lays `from` over `to`, scaled from the top-left corner.
const toward = (from: DOMRect, to: DOMRect, progress: number) => {
  const dx = (to.left - from.left) * progress
  const dy = (to.top - from.top) * progress
  const sx = 1 + (to.width / from.width - 1) * progress
  const sy = 1 + (to.height / from.height - 1) * progress
  return { dx, dy, sx, sy }
}

const transform = ({ dx, dy, sx, sy }: ReturnType<typeof toward>): string =>
  `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`

// Width goes first and height follows, the squeeze that makes it read as being
// drawn into the pill rather than simply shrinking.
const genieFrames = (from: DOMRect, to: DOMRect): Keyframe[] => {
  const mid = toward(from, to, 0.55)
  const narrowed = toward(from, to, 0.85)
  return [
    { transform: transform(toward(from, to, 0)), opacity: 1 },
    {
      transform: transform({
        ...mid,
        sy: 1 + (to.height / from.height - 1) * 0.25,
      }),
      opacity: 0.9,
      offset: 0.55,
    },
    { transform: transform(narrowed), opacity: 0.5, offset: 0.85 },
    { transform: transform(toward(from, to, 1)), opacity: 0 },
  ]
}

const nudgePill = (): void => {
  document
    .querySelector<HTMLElement>(PILL)
    ?.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.06)' },
        { transform: 'scale(1)' },
      ],
      { duration: 240, easing: EASE_OUT },
    )
}

/**
 * Shrinks Home's chat box into the sidebar's Chat pill. Called as the
 * candidate leaves Home from the sidebar; the copy it animates lives on
 * <body>, so it keeps playing while the next page renders.
 */
export const morphComposerIntoPill = (): void => {
  if (prefersReducedMotion()) return
  const composer = document.querySelector<HTMLElement>(COMPOSER)
  const from = visibleRect(COMPOSER)
  const to = visibleRect(PILL)
  if (!composer || !from || !to) return

  const ghost = composer.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-chat-morph')
  ghost.setAttribute('aria-hidden', 'true')
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: '0',
    zIndex: '50',
    pointerEvents: 'none',
    transformOrigin: 'top left',
  })
  document.body.appendChild(ghost)

  const animation = ghost.animate(genieFrames(from, to), {
    duration: DURATION_OUT_MS,
    easing: EASE_IN,
    fill: 'forwards',
  })
  animation.onfinish = () => {
    ghost.remove()
    nudgePill()
  }
  animation.oncancel = () => ghost.remove()
  // A browser pauses animations in a background tab, so one that never
  // finishes must not leave its copy of the box over the next page.
  window.setTimeout(() => ghost.remove(), DURATION_OUT_MS + 250)
}

/** Marks Home renders in the next moment as arriving from the sidebar. */
export const markArrivingAtHome = (): void => {
  try {
    window.sessionStorage.setItem(ARRIVING_KEY, String(Date.now()))
  } catch {}
}

/**
 * Grows Home's chat box out of the Chat pill, when Home was reached from the
 * sidebar. Run once the box has laid out.
 */
export const morphComposerOutOfPill = (composer: HTMLElement): void => {
  let arriving = false
  try {
    const markedAt = Number(window.sessionStorage.getItem(ARRIVING_KEY))
    arriving = markedAt > 0 && Date.now() - markedAt < ARRIVING_EXPIRES_MS
  } catch {}
  if (!arriving || prefersReducedMotion()) return
  // A second mount of the same box mid-animation leaves it be.
  if (composer.getAnimations().length > 0) return

  // The sidebar can render a beat after Home's box, so wait briefly for the
  // pill with the box hidden; it would otherwise flash in place and then jump
  // back to the pill to grow. Shown as-is if the pill never turns up.
  const opacity = composer.style.opacity
  composer.style.opacity = '0'
  const startedAt = performance.now()
  const waitForPill = (): void => {
    const from = visibleRect(PILL)
    if (!from && performance.now() - startedAt < PILL_WAIT_MS) {
      // A timer, not requestAnimationFrame, which never fires in a
      // background tab and would leave the box hidden.
      window.setTimeout(waitForPill, 16)
      return
    }
    composer.style.opacity = opacity
    const to = composer.getBoundingClientRect()
    if (from && to.width > 0) growFromPill(composer, from, to)
  }
  waitForPill()
}

const growFromPill = (
  composer: HTMLElement,
  from: DOMRect,
  to: DOMRect,
): void => {
  // The same squeeze, played backwards from the pill: reversed order, and
  // each offset mirrored so they still run from 0 to 1.
  const frames = genieFrames(to, from)
    .reverse()
    .map((frame) =>
      typeof frame.offset === 'number'
        ? { ...frame, offset: 1 - frame.offset }
        : frame,
    )
  const origin = composer.style.transformOrigin
  composer.style.transformOrigin = 'top left'
  const animation = composer.animate(frames, {
    duration: DURATION_IN_MS,
    easing: EASE_OUT,
  })
  const restore = (): void => {
    composer.style.transformOrigin = origin
  }
  animation.onfinish = () => {
    restore()
    try {
      window.sessionStorage.removeItem(ARRIVING_KEY)
    } catch {}
  }
  animation.oncancel = restore
}
