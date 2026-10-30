// No 'use client': every caller is already a client component.
import { useEffect, useState } from 'react'

// Design: confettiField — a burst of brand-blue pieces dropping through the
// success card once, with a staggered start so it reads as a shower.
const COLORS = [
  'bg-brand-blue-300',
  'bg-brand-blue-400',
  'bg-primary',
  'bg-brand-midnight-300',
]

const pageIsShowing = (): boolean =>
  document.visibilityState === 'visible' &&
  getComputedStyle(document.body).opacity !== '0'

// The burst is a one-shot CSS animation whose clock starts when its pieces
// mount, whether or not anything is on screen yet. So the pieces wait for
// the frame that paints the message beside them, and for the page to be
// showing (not a background tab, not a <body> hidden by anti-flicker);
// otherwise most of it has fallen before the words appear.
const useShownOnScreen = (): boolean => {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    let frame = 0
    const check = (): void => {
      if (pageIsShowing()) setShown(true)
      else frame = requestAnimationFrame(check)
    }
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return shown
}

export const ConfettiField = (): React.JSX.Element => {
  const shown = useShownOnScreen()
  return (
    <div
      aria-hidden
      data-testid="confetti-field"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl"
    >
      {shown &&
        Array.from({ length: 26 }).map((_, i) => (
          <span
            key={i}
            data-testid="confetti-piece"
            className={`absolute top-0 opacity-0 ${COLORS[i % COLORS.length]} ${
              i % 3
                ? 'h-[9px] w-[5px] rounded-[2px]'
                : 'size-[7px] rounded-full'
            }`}
            style={{
              left: `${2 + i * 3.7}%`,
              animation: `gp-confetti-drop ${(1.7 + (i % 5) * 0.22).toFixed(2)}s linear ${((i % 8) * 0.09).toFixed(2)}s 1 forwards`,
            }}
          />
        ))}
    </div>
  )
}
