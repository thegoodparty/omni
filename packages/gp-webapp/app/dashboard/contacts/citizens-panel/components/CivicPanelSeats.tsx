import type {
  CivicPanelCompositionPlace,
  CivicPanelPlaceKind,
} from '@goodparty_org/contracts'
import { cn } from '@styleguide/lib/utils'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import {
  buildSeats,
  SEAT_HUES,
  SEAT_R_OUT,
  SEAT_SIZE,
  type SeatChart,
  type SeatHue,
} from './panelCharts'

// Darkest tint first. Each seat is outlined in its family's darkest tint so
// the light ones still read on white.
export const SEAT_FILL: Record<SeatHue, [string, string, string]> = {
  red: ['fill-brand-red-500', 'fill-brand-red-400', 'fill-brand-red-300'],
  blue: ['fill-brand-blue-600', 'fill-brand-blue-500', 'fill-brand-blue-300'],
  lavender: [
    'fill-brand-lavender-800',
    'fill-brand-lavender-700',
    'fill-brand-lavender-600',
  ],
}
export const SEAT_OUTLINE: Record<SeatHue, string> = {
  red: 'stroke-brand-red-500',
  blue: 'stroke-brand-blue-600',
  lavender: 'stroke-brand-lavender-800',
}
const PLACE_DOT: Record<SeatHue, string> = {
  red: 'bg-brand-red-500',
  blue: 'bg-brand-blue-600',
  lavender: 'bg-brand-lavender-800',
}

// The arc alone, tight to the seats so it reads large on a phone.
export const SEAT_FRAME = {
  width: 2 * (SEAT_R_OUT + SEAT_SIZE),
  top: SEAT_R_OUT + SEAT_SIZE,
}

export type PlaceWords = (typeof COPY.seatPlaces)[CivicPanelPlaceKind]

// `quiet` draws the seats filling and nothing else: no place outlined as
// behind or empty, for the panel page's lead card, which has no legend.
export const SeatArc = ({
  chart,
  words,
  quiet = false,
  className,
}: {
  chart: SeatChart
  words: PlaceWords
  quiet?: boolean
  className?: string
}) => {
  const cx = SEAT_FRAME.width / 2
  const cy = SEAT_FRAME.top
  const height = cy + SEAT_SIZE / 2 + 4
  const nearFull = !quiet && chart.stage === 'nearFull'
  return (
    <svg
      viewBox={`0 0 ${SEAT_FRAME.width} ${height}`}
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label={
        quiet
          ? COPY.seatsSummary(chart.filled, 0, words.one, words.many)
          : COPY.seatsAtShareSummary(
              chart.filled,
              chart.behind.length,
              words.one,
              words.many,
            )
      }
    >
      {/* Built around (0, 0) and moved into place. */}
      <g transform={`translate(${cx} ${cy})`}>
        {chart.seats.map((seat, i) => {
          const place = chart.places[seat.place]
          const warn = nearFull || (!quiet && (place?.behind ?? false))
          const hue = place?.hue ?? 'red'
          return seat.filled ? (
            <circle
              key={i}
              cx={seat.x}
              cy={seat.y}
              r={SEAT_SIZE / 2 - 0.5}
              strokeWidth={1}
              className={cn(SEAT_FILL[hue][seat.tint], SEAT_OUTLINE[hue])}
            />
          ) : (
            <circle
              key={i}
              cx={seat.x}
              cy={seat.y}
              r={SEAT_SIZE / 2 - 1}
              strokeWidth={2}
              className={cn(
                'fill-background',
                warn ? 'stroke-warning' : 'stroke-border',
              )}
            />
          )
        })}
      </g>
    </svg>
  )
}

const LegendDot = ({ className }: { className: string }) => (
  <span aria-hidden className={cn('size-2.5 rounded-full', className)} />
)

const Legend = ({ chart }: { chart: SeatChart }) => {
  const anyEmpty = chart.seats.some((seat) => !seat.filled)
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="flex gap-0.5">
          {SEAT_HUES.map((hue) => (
            <LegendDot key={hue} className={PLACE_DOT[hue]} />
          ))}
        </span>
        {COPY.legendMember}
      </span>
      {!anyEmpty ? null : chart.stage === 'nearFull' ? (
        <span className="flex items-center gap-1.5">
          <LegendDot className="border-2 border-warning bg-background" />
          {COPY.legendEmpty}
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <LegendDot className="border-2 border-border bg-background" />
            {COPY.legendNotFilled}
          </span>
          {chart.stage !== 'tooEarly' ? (
            <span className="flex items-center gap-1.5">
              <LegendDot className="border-2 border-warning bg-background" />
              {COPY.legendBehind}
            </span>
          ) : null}
        </>
      )}
    </div>
  )
}

// The district as 100 seats split by tract or precinct, filling as members
// join. Which places are behind is the civic panel page's to list (Who
// we're inviting next), so this is the chart alone, the same on a phone and
// a computer.
export const CivicPanelSeats = ({
  placeKind,
  places,
  members,
  goal,
}: {
  placeKind: CivicPanelPlaceKind
  places: CivicPanelCompositionPlace[]
  members: number
  goal: number
}) => {
  const words = COPY.seatPlaces[placeKind]
  const chart = buildSeats({ places, members, goal, cx: 0, cy: 0 })
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-5"
      data-testid="civic-panel-seats"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {words.title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {COPY.seatsCaption}
        </p>
      </div>
      <div className="mx-auto flex w-full max-w-[40rem] flex-col items-center gap-2">
        <SeatArc chart={chart} words={words} />
        <p className="text-center text-sm text-muted-foreground">
          {COPY.seatsAtShare(chart.filled, words.one)}
        </p>
      </div>
      <Legend chart={chart} />
    </section>
  )
}
