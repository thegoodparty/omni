import {
  PANEL_MIN_MEMBERS_FOR_BALANCE,
  type CivicPanelCompositionPlace,
  type CivicPanelPlaceKind,
} from '@goodparty_org/contracts'
import { cn } from '@styleguide/lib/utils'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import {
  buildSeats,
  LABEL_ALL_UP_TO,
  labelAnchor,
  LIST_SIZE,
  SEAT_R_OUT,
  SEAT_SIZE,
  spreadLabels,
  type SeatChart,
  type SeatPlace,
} from './panelCharts'

// The arc alone, tight to the seats so it reads large on a phone.
const PLAIN = {
  width: 2 * (SEAT_R_OUT + SEAT_SIZE),
  top: SEAT_R_OUT + SEAT_SIZE,
}
// Room around the arc for each place's name.
const LABELED = { width: 2 * (SEAT_R_OUT + 120), top: SEAT_R_OUT + 52 }
const LABEL_GAP = 10

type PlaceWords = (typeof COPY.seatPlaces)[CivicPanelPlaceKind]

const LABEL_R = SEAT_R_OUT + SEAT_SIZE / 2 + LABEL_GAP

// Each place's name beside its seats, the first line's baseline at `y`.
// Names over the top sit above their point; the sides are spread apart.
const placeLabels = (chart: SeatChart) => {
  const labels = chart.places.map((place) => {
    const cos = Math.cos(place.angle)
    const sin = Math.sin(place.angle)
    const y = -LABEL_R * sin
    return {
      place,
      x: LABEL_R * cos,
      y: sin > 0.7 ? y - 18 : y - 3,
      anchor: labelAnchor(cos),
    }
  })
  for (const side of ['start', 'end'] as const) {
    const onSide = labels.filter((label) => label.anchor === side)
    spreadLabels(onSide.map((label) => label.y)).forEach((y, i) => {
      const label = onSide[i]
      if (label) label.y = y
    })
  }
  return labels
}

const SeatArc = ({
  chart,
  words,
  labeled,
  className,
}: {
  chart: SeatChart
  words: PlaceWords
  labeled: boolean
  className?: string
}) => {
  const frame = labeled ? LABELED : PLAIN
  const cx = frame.width / 2
  const cy = frame.top
  const height = cy + SEAT_SIZE / 2 + (labeled ? 30 : 4)
  const nearFull = chart.stage === 'nearFull'
  return (
    <svg
      viewBox={`0 0 ${frame.width} ${height}`}
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label={COPY.seatsSummary(
        chart.filled,
        chart.behind.length,
        words.one,
        words.many,
      )}
    >
      {/* Built around (0, 0) and moved into place, so one build serves both
          frames. */}
      <g transform={`translate(${cx} ${cy})`}>
        {chart.seats.map((seat, i) => {
          const place = chart.places[seat.place]
          const warn = nearFull || (place?.behind ?? false)
          return seat.filled ? (
            <circle
              key={i}
              cx={seat.x}
              cy={seat.y}
              r={SEAT_SIZE / 2}
              className={
                place?.shade === 1 ? 'fill-primary/60' : 'fill-primary'
              }
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
        {labeled
          ? placeLabels(chart).map(({ place, x, y, anchor }) => {
              const short = place.empty > 0
              return (
                <text
                  key={place.key}
                  x={x}
                  y={y}
                  textAnchor={anchor}
                  className="text-xs"
                >
                  <tspan
                    x={x}
                    className={cn(
                      short
                        ? 'fill-warning-dark font-semibold'
                        : 'fill-foreground font-medium',
                    )}
                  >
                    {words.name(place.name)}
                  </tspan>
                  <tspan
                    x={x}
                    dy={16}
                    className={
                      short ? 'fill-warning-dark' : 'fill-muted-foreground'
                    }
                  >
                    {short ? COPY.emptySeats(place.empty) : COPY.placeFull}
                  </tspan>
                </text>
              )
            })
          : null}
      </g>
    </svg>
  )
}

const PlaceRow = ({
  place,
  words,
}: {
  place: SeatPlace
  words: PlaceWords
}) => (
  <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[8.75rem_minmax(0,1fr)_auto]">
    <span className="truncate text-sm text-foreground">
      {words.name(place.name)}
    </span>
    <span
      aria-hidden
      className="col-span-2 row-start-2 flex flex-wrap gap-1 sm:col-span-1 sm:row-start-1"
    >
      {Array.from({ length: place.count }, (_, k) => (
        <span
          key={k}
          className={cn(
            'size-3 rounded-full',
            k < place.filled
              ? 'bg-primary'
              : 'border-2 border-warning bg-background',
          )}
        />
      ))}
    </span>
    <span
      className={cn(
        'text-right text-sm',
        place.empty > 0 ? 'text-warning-dark' : 'text-muted-foreground',
      )}
    >
      {COPY.seatsOf(place.filled, place.count)}
    </span>
  </li>
)

const PlaceList = ({
  title,
  places,
  words,
  className,
}: {
  title: string
  places: SeatPlace[]
  words: PlaceWords
  className?: string
}) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    <ul className="flex flex-col gap-2">
      {places.map((place) => (
        <PlaceRow key={place.key} place={place} words={words} />
      ))}
    </ul>
  </div>
)

const LegendDot = ({ className }: { className: string }) => (
  <span aria-hidden className={cn('size-2.5 rounded-full', className)} />
)

const Legend = ({ chart }: { chart: SeatChart }) => (
  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
    <span className="flex items-center gap-1.5">
      <LegendDot className="bg-primary" />
      {COPY.legendMember}
    </span>
    {chart.stage === 'nearFull' ? (
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

const inviteNext = (place: SeatPlace | undefined, words: PlaceWords) =>
  place ? COPY.inviteMore(words.invite(place.name)) : null

const Footer = ({ chart, words }: { chart: SeatChart; words: PlaceWords }) => {
  const line = 'border-t border-border pt-3 text-sm'
  if (chart.stage === 'tooEarly') {
    return (
      <p className={cn(line, 'text-muted-foreground')}>
        {COPY.balanceTooFew(PANEL_MIN_MEMBERS_FOR_BALANCE)}
      </p>
    )
  }
  if (chart.stage === 'full') {
    return <p className={cn(line, 'text-foreground')}>{words.full}</p>
  }
  if (chart.stage === 'nearFull') {
    const labeled = chart.places.length <= LABEL_ALL_UP_TO
    return (
      <div className={cn(line, 'flex flex-col gap-3')}>
        <PlaceList
          title={COPY.mostEmptySeats}
          words={words}
          places={
            labeled ? chart.mostEmpty : chart.mostEmpty.slice(0, LIST_SIZE)
          }
          // Around the arc on a computer when every place fits there.
          className={labeled ? 'sm:hidden' : undefined}
        />
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            {COPY.emptyIn(
              chart.mostEmpty.length,
              chart.places.length,
              words.many,
            )}
          </p>
          <p className="font-semibold text-foreground">
            {inviteNext(
              [...chart.mostEmpty].sort((a, b) => a.progress - b.progress)[0],
              words,
            )}
          </p>
        </div>
      </div>
    )
  }
  if (chart.behind.length === 0) return null
  return (
    <div className={cn(line, 'flex flex-col gap-3')}>
      <PlaceList
        title={COPY.furthestBehind}
        places={chart.behind.slice(0, LIST_SIZE)}
        words={words}
      />
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground">
          {COPY.placesBehind(
            chart.behind.length,
            chart.places.length,
            words.many,
          )}
        </p>
        <p className="font-semibold text-foreground">
          {inviteNext(chart.behind[0], words)}
        </p>
      </div>
    </div>
  )
}

// The district as 100 seats split by tract or precinct, filling as members
// join.
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
  const labeled =
    chart.stage === 'nearFull' && chart.places.length <= LABEL_ALL_UP_TO
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
        {labeled ? (
          <>
            <SeatArc
              chart={chart}
              words={words}
              labeled
              className="hidden sm:block"
            />
            <SeatArc
              chart={chart}
              words={words}
              labeled={false}
              className="sm:hidden"
            />
          </>
        ) : (
          <SeatArc chart={chart} words={words} labeled={false} />
        )}
        <p className="text-center text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{chart.filled}</span>
          {COPY.seatsFilled}
        </p>
      </div>
      <Legend chart={chart} />
      <Footer chart={chart} words={words} />
    </section>
  )
}
