import { useEffect, useState } from 'react'
import { cn } from '@styleguide/lib/utils'
import { MANAGED_PANEL_COPY } from '../managedPanelCopy'
import { SEAT_FILL, SEAT_OUTLINE } from './CivicPanelSeats'
import {
  SEAT_COUNT,
  SEAT_HUES,
  SEAT_R_OUT,
  SEAT_SIZE,
  seatSpots,
  type SeatTint,
} from './panelCharts'

// About 5 seconds for all 100 seats.
export const SEAT_FILL_MS = 50

const WIDTH = 2 * (SEAT_R_OUT + SEAT_SIZE)
const TOP = SEAT_R_OUT + SEAT_SIZE
const HEIGHT = TOP + SEAT_SIZE / 2 + 4

// The same arc for everyone: an illustration, not anyone's panel. Each
// seat's color is fixed by its position, mixed so neighbors differ, and the
// seats fill in a scattered order rather than left to right.
const SEATS = seatSpots(0, 0).map((spot, i) => ({
  ...spot,
  hue: SEAT_HUES[(i + Math.floor(i / 9)) % SEAT_HUES.length] ?? 'red',
  tint: (Math.floor(i / 3) % 3) as SeatTint,
}))
const FILL_RANK = SEATS.map((_, i) => i)
  .sort((a, b) => ((a * 37) % 101) - ((b * 37) % 101))
  .reduce<number[]>((rank, seat, order) => {
    rank[seat] = order
    return rank
  }, [])

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

// The managed civic panel card's picture: 100 empty seats that fill once,
// when the card appears. With reduced motion the arc shows full.
export const ManagedPanelSeats = ({ className }: { className?: string }) => {
  const [filled, setFilled] = useState(() =>
    prefersReducedMotion() ? SEAT_COUNT : 0,
  )
  useEffect(() => {
    if (filled >= SEAT_COUNT) return
    const timer = window.setInterval(() => {
      setFilled((count) => {
        const next = Math.min(SEAT_COUNT, count + 1)
        if (next >= SEAT_COUNT) window.clearInterval(timer)
        return next
      })
    }, SEAT_FILL_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the card appears
  }, [])

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label={MANAGED_PANEL_COPY.seatsLabel(filled)}
      data-testid="managed-panel-seats"
      data-filled={filled}
    >
      <g transform={`translate(${WIDTH / 2} ${TOP})`}>
        {SEATS.map((seat, i) =>
          (FILL_RANK[i] ?? 0) < filled ? (
            <circle
              key={i}
              cx={seat.x}
              cy={seat.y}
              r={SEAT_SIZE / 2 - 0.5}
              strokeWidth={1}
              className={cn(
                SEAT_FILL[seat.hue][seat.tint],
                SEAT_OUTLINE[seat.hue],
              )}
            />
          ) : (
            <circle
              key={i}
              cx={seat.x}
              cy={seat.y}
              r={SEAT_SIZE / 2 - 1}
              strokeWidth={2}
              className="fill-background stroke-border"
            />
          ),
        )}
      </g>
    </svg>
  )
}
