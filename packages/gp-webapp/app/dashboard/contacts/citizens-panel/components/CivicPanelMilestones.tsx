import Link from 'next/link'
import {
  PANEL_MIN_MEMBERS_FOR_BALANCE,
  type CivicPanelProgress,
  type CivicPanelComposition,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import { CheckIcon, CircleCheckIcon } from '@styleguide/components/ui/icons'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import {
  buildBloom,
  buildSeats,
  milestones,
  NEAR_FULL_AT,
  SEAT_COUNT,
  type Milestone,
} from './panelCharts'

// Asking the panel a question starts from a priority.
const ASK_PANEL_HREF = '/dashboard/priorities'

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
        <span className={cn('text-xs', STEP_LABEL[step.state])}>
          {COPY.milestone[step.key](step.at)}
          <span className="sr-only">
            {`, ${COPY.milestoneState[step.state]}`}
          </span>
        </span>
      </li>
    ))}
  </ol>
)

const Card = ({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) => (
  <section
    className={cn(
      'flex flex-col items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 px-6 py-6 text-center',
      className,
    )}
    data-testid="civic-panel-milestones"
  >
    {children}
  </section>
)

// Where the panel is toward its goal, in place of a progress bar: a line
// for the stage it is at and its four milestones, or, once every seat is
// filled, the full panel and a way to ask it something.
export const CivicPanelMilestones = ({
  progress,
  composition,
}: {
  progress: CivicPanelProgress
  composition: CivicPanelComposition | null
}) => {
  const { members, goal } = progress
  const steps = milestones(members, goal)
  const words = composition ? COPY.seatPlaces[composition.placeKind] : null
  const chart =
    composition && composition.places.length > 0
      ? buildSeats({
          places: composition.places,
          members,
          goal,
          cx: 0,
          cy: 0,
        })
      : null

  const full = members >= goal && (!chart || chart.stage === 'full')
  if (full) {
    const placeCount = chart?.places.length ?? 0
    // Counted the way the petals below count, so the two never disagree.
    const bloom =
      composition && composition.groups.length > 0
        ? buildBloom(composition.groups)
        : null
    return (
      <Card className="py-8">
        <CircleCheckIcon aria-hidden className="size-14 text-primary" />
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-semibold text-foreground">
            {COPY.fullTitle}
          </h2>
          <p className="max-w-[26rem] text-base text-muted-foreground">
            {chart && words
              ? COPY.fullLine(members, placeCount, words.many)
              : COPY.fullLineNoPlaces(members)}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">
              {members.toLocaleString('en-US')}
            </span>
            {COPY.fullMembers}
          </span>
          {chart && words ? (
            <span>
              <span className="font-semibold text-foreground">
                {placeCount}
              </span>
              {COPY.fullPlaces(placeCount, words.many)}
            </span>
          ) : null}
          {bloom ? (
            <span>
              <span className="font-semibold text-foreground">
                {bloom.atShare}
              </span>
              {COPY.fullGroups(bloom.petals.length)}
            </span>
          ) : null}
        </div>
        <Steps steps={steps} />
        <Button asChild>
          <Link href={ASK_PANEL_HREF}>{COPY.askPanel}</Link>
        </Button>
      </Card>
    )
  }

  const pace =
    chart && words && chart.stage !== 'tooEarly'
      ? COPY.keepingPace(
          members,
          chart.places.length - chart.behind.length,
          chart.places.length,
          words.many,
        )
      : COPY.saidYes(members)
  const almost = members >= goal * NEAR_FULL_AT
  const title =
    members === 0
      ? COPY.cheerStart
      : almost
        ? COPY.cheerAlmost
        : members >= Math.ceil(goal / 2)
          ? COPY.cheerHalfway
          : members < PANEL_MIN_MEMBERS_FOR_BALANCE
            ? COPY.cheerStarted
            : COPY.cheerGrowing
  const line =
    members === 0
      ? COPY.cheerStartLine
      : !almost
        ? pace
        : chart && words
          ? COPY.seatsToGo(
              SEAT_COUNT - chart.filled,
              chart.places.length - chart.mostEmpty.length,
              chart.places.length,
              words.many,
            )
          : COPY.membersToGo(Math.max(1, goal - members))

  return (
    <Card>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[22px] font-semibold text-foreground">{title}</h2>
        <p className="max-w-[28rem] text-base text-muted-foreground">{line}</p>
      </div>
      <Steps steps={steps} />
    </Card>
  )
}
