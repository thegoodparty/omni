import type { CivicPanelPlaceKind } from '@goodparty_org/contracts'
import { Progress } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import { CheckIcon } from '@styleguide/components/ui/icons'
import {
  SERVE_CITIZENS_PANEL_COPY as COPY,
  type CivicPanelStage,
} from '../citizensPanelCopy'
import { SeatArc } from './CivicPanelSeats'
import { milestones, plainSeats, type Milestone } from './panelCharts'

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
  placeKind = 'tract',
}: {
  stage: CivicPanelStage
  members: number
  goal: number
  placeKind?: CivicPanelPlaceKind
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
          {copy.line(members, goal)}
        </p>
      </div>
      {/* The seats need room; below lg a bar says the same. */}
      <div className="hidden w-full justify-center lg:flex">
        <SeatArc
          chart={plainSeats(members, goal)}
          words={COPY.seatPlaces[placeKind]}
          labeled={false}
          quiet
          className="max-w-[32rem]"
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
        <Progress
          value={Math.min(100, Math.round((members / Math.max(1, goal)) * 100))}
          aria-label={joined}
        />
      </div>
      <Steps steps={milestones(members, goal)} />
    </section>
  )
}
