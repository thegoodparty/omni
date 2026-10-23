import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { cn } from '@styleguide'
import {
  allocate,
  SEAT_COUNT,
  SEAT_R_OUT,
  SEAT_SIZE,
  seatSpots,
} from 'app/dashboard/contacts/citizens-panel/components/panelCharts'
import { READ_STATUS_COPY } from '../readStatusCopy'

export type GroupSeatState = 'heard' | 'next' | 'notYet'

// The civic panel's 100 seats, split evenly between the read's groups, left
// to right: heard first, then the groups the read needs answers from next,
// then the rest. A read only counts groups, so the order is by state.
export const groupSeats = (
  read: PriorityReadStatus,
): Array<{ x: number; y: number; state: GroupSeatState }> => {
  const total = read.groupsTotal
  const heard = Math.min(read.groupsHeard, total)
  const next = Math.min(read.groupsNext ?? 0, total - heard)
  const perGroup = allocate(Array<number>(total).fill(1), SEAT_COUNT)
  const spots = seatSpots(0, 0)
  const seats: Array<{ x: number; y: number; state: GroupSeatState }> = []
  let cursor = 0
  perGroup.forEach((count, i) => {
    const state: GroupSeatState =
      i < heard ? 'heard' : i < heard + next ? 'next' : 'notYet'
    spots.slice(cursor, cursor + count).forEach((spot) => {
      seats.push({ x: spot.x, y: spot.y, state })
    })
    cursor += count
  })
  return seats
}

// Filled dark blue, an orange ring and a light grey ring: they differ in
// lightness as well as hue.
const SEAT_CLASS: Record<GroupSeatState, string> = {
  heard: 'fill-primary stroke-primary',
  next: 'fill-background stroke-warning',
  notYet: 'fill-background stroke-border',
}
const LEGEND_CLASS: Record<GroupSeatState, string> = {
  heard: 'bg-primary',
  next: 'border-2 border-warning bg-background',
  notYet: 'border-2 border-border bg-background',
}
const LEGEND_LABEL: Record<GroupSeatState, string> = {
  heard: READ_STATUS_COPY.legendHeard,
  next: READ_STATUS_COPY.legendNext,
  notYet: READ_STATUS_COPY.legendNotYet,
}

const WIDTH = 2 * (SEAT_R_OUT + SEAT_SIZE)
const TOP = SEAT_R_OUT + SEAT_SIZE
const HEIGHT = TOP + SEAT_SIZE / 2 + 4

export const GroupSeatsArc = ({
  readStatus,
  className,
}: {
  readStatus: PriorityReadStatus
  className?: string
}): React.JSX.Element => (
  <svg
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    className={cn('h-auto w-full', className)}
    role="img"
    aria-label={READ_STATUS_COPY.progress(readStatus)}
    data-testid="group-seats"
  >
    <g transform={`translate(${WIDTH / 2} ${TOP})`}>
      {groupSeats(readStatus).map((seat, i) => (
        <circle
          key={i}
          cx={seat.x}
          cy={seat.y}
          r={seat.state === 'heard' ? SEAT_SIZE / 2 - 0.5 : SEAT_SIZE / 2 - 1}
          strokeWidth={seat.state === 'heard' ? 1 : 2}
          data-state={seat.state}
          className={SEAT_CLASS[seat.state]}
        />
      ))}
    </g>
  </svg>
)

// Only the states the arc shows, so a key never names a seat not drawn.
export const GroupSeatsLegend = ({
  readStatus,
  className,
}: {
  readStatus: PriorityReadStatus
  className?: string
}): React.JSX.Element => {
  const shown = new Set(groupSeats(readStatus).map((seat) => seat.state))
  return (
    <ul
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {(['heard', 'next', 'notYet'] as const)
        .filter((state) => shown.has(state))
        .map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn('size-2.5 rounded-full', LEGEND_CLASS[state])}
            />
            {LEGEND_LABEL[state]}
          </li>
        ))}
    </ul>
  )
}
