import {
  NO_CIVIC_PANEL_JOINS,
  type CivicPanelJoinedBy,
} from '@goodparty_org/contracts'
import { cn } from '@styleguide/lib/utils'
import { CheckIcon } from '@styleguide/components/ui/icons'
import {
  SERVE_CITIZENS_PANEL_COPY as COPY,
  type CivicPanelStage,
} from '../citizensPanelCopy'
import { SEAT_FRAME } from './CivicPanelSeats'
import {
  JOIN_SOURCES,
  joinedBySources,
  milestones,
  SEAT_SIZE,
  sourceSeats,
  type JoinSource,
  type Milestone,
} from './panelCharts'

// Each way of joining in its own color, apart in lightness as well as hue
// so the three still read apart without color: the brand blue for a text,
// a dark navy for the door, a light orange for a call.
const SOURCE_FILL: Record<JoinSource, string> = {
  text: 'fill-primary',
  door: 'fill-brand-midnight-800',
  phone: 'fill-orange-400',
}
const SOURCE_BG: Record<JoinSource, string> = {
  text: 'bg-primary',
  door: 'bg-brand-midnight-800',
  phone: 'bg-orange-400',
}

const LegendDot = ({ className }: { className: string }) => (
  <span
    aria-hidden
    className={cn('size-2.5 shrink-0 rounded-full', className)}
  />
)

// How the members joined, leaving out a way nobody joined by. The seats
// add an empty seat; the bar's empty track needs no key.
const JoinLegend = ({
  joinedBy,
  emptySeat = false,
  testId,
}: {
  joinedBy: CivicPanelJoinedBy
  emptySeat?: boolean
  testId: string
}) => {
  const bySource = joinedBySources(joinedBy)
  const shown = JOIN_SOURCES.filter((source) => bySource[source] > 0)
  if (shown.length === 0) return null
  return (
    <ul
      aria-label={COPY.joinedByLabel}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground"
      data-testid={testId}
    >
      {shown.map((source) => (
        <li key={source} className="flex items-center gap-1.5">
          <LegendDot className={SOURCE_BG[source]} />
          {COPY.joinedBy[source](bySource[source])}
        </li>
      ))}
      {emptySeat ? (
        <li className="flex items-center gap-1.5">
          <LegendDot className="border-2 border-border bg-background" />
          {COPY.legendEmpty}
        </li>
      ) : null}
    </ul>
  )
}

// The goal as 100 seats, each filled seat in the color of how its member
// joined.
const SourceSeatArc = ({
  members,
  goal,
  joinedBy,
}: {
  members: number
  goal: number
  joinedBy: CivicPanelJoinedBy
}) => {
  const { seats, filled } = sourceSeats(members, goal, joinedBy)
  const cx = SEAT_FRAME.width / 2
  const cy = SEAT_FRAME.top
  return (
    <svg
      viewBox={`0 0 ${SEAT_FRAME.width} ${cy + SEAT_SIZE / 2 + 4}`}
      className="h-auto w-full max-w-[32rem]"
      role="img"
      aria-label={COPY.seatsSummary(filled, 0, '', '')}
      data-testid="civic-panel-hero-seats"
    >
      <g transform={`translate(${cx} ${cy})`}>
        {seats.map((seat, i) =>
          seat.source ? (
            <circle
              key={i}
              cx={seat.x}
              cy={seat.y}
              r={SEAT_SIZE / 2 - 0.5}
              className={SOURCE_FILL[seat.source]}
              data-source={seat.source}
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

// The bar below lg: one segment per way of joining, in the seats' order
// and colors, each its share of the goal.
const SourceBar = ({
  members,
  goal,
  joinedBy,
  label,
}: {
  members: number
  goal: number
  joinedBy: CivicPanelJoinedBy
  label: string
}) => {
  const counted = joinedBySources(joinedBy)
  // With no join sources to split by, the members all show as text, as
  // the seats do.
  const bySource = JOIN_SOURCES.some((source) => counted[source] > 0)
    ? counted
    : { text: members, door: 0, phone: 0 }
  let left = 100
  const widths = JOIN_SOURCES.map((source) => {
    const width = Math.min(left, (bySource[source] / Math.max(1, goal)) * 100)
    left -= width
    return { source, width }
  })
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-3 w-full overflow-hidden rounded-full bg-primary/20"
    >
      {widths.map(({ source, width }) =>
        width > 0 ? (
          <span
            key={source}
            className={cn('h-full', SOURCE_BG[source])}
            style={{ width: `${width}%` }}
            data-source={source}
          />
        ) : null,
      )}
    </div>
  )
}

const STEP_CIRCLE: Record<Milestone['state'], string> = {
  done: 'bg-primary',
  next: 'border-2 border-primary bg-background',
  upcoming: 'border-2 border-border bg-background',
}

const STEP_LABEL: Record<Milestone['state'], string> = {
  done: 'text-foreground',
  next: 'font-semibold text-foreground',
  upcoming: 'text-muted-foreground',
}

const Steps = ({ steps }: { steps: Milestone[] }) => (
  <ol
    aria-label={COPY.milestonesLabel}
    className="grid w-full max-w-[30rem] grid-cols-4 gap-2"
  >
    {steps.map((step) => (
      <li key={step.key} className="flex flex-col items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            'flex size-7 items-center justify-center rounded-full',
            STEP_CIRCLE[step.state],
          )}
        >
          {step.state === 'done' ? (
            <CheckIcon className="size-3.5 text-primary-foreground" />
          ) : null}
        </span>
        <span className={cn('text-sm', STEP_LABEL[step.state])}>
          {COPY.milestone[step.key](step.at)}
          <span className="sr-only">
            {`, ${COPY.milestoneState[step.state]}`}
          </span>
        </span>
      </li>
    ))}
  </ol>
)

// The page's lead card: where the panel stands in a line, the goal as 100
// seats filling as residents join, and its four milestones.
export const CivicPanelHero = ({
  stage,
  members,
  goal,
  place = null,
  joinedBy = NO_CIVIC_PANEL_JOINS,
}: {
  stage: CivicPanelStage
  members: number
  goal: number
  place?: string | null
  joinedBy?: CivicPanelJoinedBy
}) => {
  const copy = COPY.hero[stage]
  const joined = COPY.joinedOfGoal(members, goal)
  return (
    <section
      className="flex flex-col items-center gap-5 rounded-xl border border-border bg-background px-5 py-6 text-center sm:px-8"
      data-testid="civic-panel-hero"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[22px] font-semibold text-foreground">
          {copy.title}
        </h2>
        <p className="max-w-[28rem] text-base text-muted-foreground">
          {copy.line(members, goal, place)}
        </p>
      </div>
      {/* The seats need room; below lg a bar says the same. */}
      <div className="hidden w-full flex-col items-center gap-3 lg:flex">
        <SourceSeatArc members={members} goal={goal} joinedBy={joinedBy} />
        <JoinLegend
          joinedBy={joinedBy}
          emptySeat
          testId="civic-panel-hero-seats-legend"
        />
      </div>
      <div
        className="flex w-full max-w-[30rem] flex-col gap-2 lg:hidden"
        data-testid="civic-panel-hero-bar"
      >
        {/* Only the start line leaves the count out; every other stage's
            line already says it. */}
        {stage === 'start' ? (
          <p className="text-base font-semibold text-foreground">{joined}</p>
        ) : null}
        <SourceBar
          members={members}
          goal={goal}
          joinedBy={joinedBy}
          label={joined}
        />
        <JoinLegend joinedBy={joinedBy} testId="civic-panel-hero-bar-legend" />
      </div>
      <Steps steps={milestones(members, goal)} />
    </section>
  )
}
