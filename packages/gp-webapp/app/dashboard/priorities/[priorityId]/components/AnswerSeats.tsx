import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { cn } from '@styleguide'
import {
  SEAT_COUNT,
  SEAT_R_OUT,
  SEAT_SIZE,
  seatSpots,
} from 'app/dashboard/contacts/citizens-panel/components/panelCharts'
import { READ_STATUS_COPY, representativeCount } from '../readStatusCopy'

export type AnswerSeatState = 'heard' | 'needed'

// The civic panel's 100 seats as the people a good read needs, left to
// right: the answers that count toward a balanced read filled, then the
// ones still needed. A group's answers past its share fill no seat. The
// arc is never full while an answer is still needed, nor empty once one is
// in.
export const answerSeats = (
  read: PriorityReadStatus,
): Array<{ x: number; y: number; state: AnswerSeatState }> => {
  const { have, need } = representativeCount(read)
  const heard =
    have >= need
      ? SEAT_COUNT
      : have <= 0
        ? 0
        : Math.min(
            SEAT_COUNT - 1,
            Math.max(1, Math.round((have / need) * SEAT_COUNT)),
          )
  return seatSpots(0, 0).map((spot, i) => ({
    x: spot.x,
    y: spot.y,
    state: i < heard ? 'heard' : 'needed',
  }))
}

// Filled dark blue and a light grey ring: they differ in lightness as well
// as hue.
const SEAT_CLASS: Record<AnswerSeatState, string> = {
  heard: 'fill-primary stroke-primary',
  needed: 'fill-background stroke-border',
}
const LEGEND_CLASS: Record<AnswerSeatState, string> = {
  heard: 'bg-primary',
  needed: 'border-2 border-border bg-background',
}
const LEGEND_LABEL: Record<AnswerSeatState, string> = {
  heard: READ_STATUS_COPY.legendHeard,
  needed: READ_STATUS_COPY.legendNeeded,
}

const WIDTH = 2 * (SEAT_R_OUT + SEAT_SIZE)
const TOP = SEAT_R_OUT + SEAT_SIZE
const HEIGHT = TOP + SEAT_SIZE / 2 + 4

export const AnswerSeatsArc = ({
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
    data-testid="answer-seats"
  >
    <g transform={`translate(${WIDTH / 2} ${TOP})`}>
      {answerSeats(readStatus).map((seat, i) => (
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
export const AnswerSeatsLegend = ({
  readStatus,
  className,
}: {
  readStatus: PriorityReadStatus
  className?: string
}): React.JSX.Element => {
  const shown = new Set(answerSeats(readStatus).map((seat) => seat.state))
  return (
    <ul
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {(['heard', 'needed'] as const)
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
