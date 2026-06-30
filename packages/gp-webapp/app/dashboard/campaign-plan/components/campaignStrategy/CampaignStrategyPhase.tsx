'use client'

import { useRef, useState } from 'react'
import { addDays, format } from 'date-fns'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
  cn,
} from '@styleguide'
import type {
  CampaignStrategyPhase as CampaignStrategyPhaseModel,
  CampaignStrategyWeek,
} from './campaignStrategy.types'
import CampaignStrategyTaskRow from './CampaignStrategyTaskRow'

interface CampaignStrategyPhaseProps {
  phase: CampaignStrategyPhaseModel
  onToggleComplete?: (id: string, completed: boolean) => void
}

// `start` is the Monday (yyyy-MM-dd); show the Mon-Sun span. Parse via the same
// Safari-safe dash->slash local-midnight trick the task rows use.
const weekLabel = (start: string): string => {
  const monday = new Date(start.replace(/-/g, '/'))
  return `${format(monday, 'MMM d')} - ${format(addDays(monday, 6), 'MMM d')}`
}

// The active phase renders one Monday-Sunday week at a time. Normally the
// candidate opens on the week containing today and can step one week back (to
// review) or one forward (next week's plan, once that Thursday's generation
// lands), but no further. When today falls outside every task week (e.g. the
// election has passed), open on the most recent week with full navigation so no
// week is stranded.
const WeekNavigator = ({
  weeks,
  onToggleComplete,
}: {
  weeks: CampaignStrategyWeek[]
  onToggleComplete?: (id: string, completed: boolean) => void
}): React.JSX.Element => {
  const rawIndex = weeks.findIndex((w) => w.isCurrent)
  const currentIndex = rawIndex === -1 ? weeks.length - 1 : rawIndex
  const [selected, setSelected] = useState(currentIndex)
  // Re-sync the open week when a background poll shifts which week is "current"
  // (a new generation, or midnight crossing into a new week); otherwise
  // `selected` keeps its stale mount-time value and silently shows last week.
  const prevCurrentIndex = useRef(currentIndex)
  if (prevCurrentIndex.current !== currentIndex) {
    prevCurrentIndex.current = currentIndex
    setSelected(currentIndex)
  }
  const lowerBound = rawIndex === -1 ? 0 : Math.max(0, currentIndex - 1)
  const upperBound =
    rawIndex === -1
      ? weeks.length - 1
      : Math.min(weeks.length - 1, currentIndex + 1)
  const week = weeks[selected] ?? weeks[currentIndex]
  if (!week) return <></>

  return (
    <div className="border-border border-t">
      <div className="flex items-center justify-between px-6 py-3">
        <Button
          type="button"
          variant="ghost"
          size="small"
          disabled={selected <= lowerBound}
          onClick={() => setSelected((i) => Math.max(lowerBound, i - 1))}
          aria-label="Previous week"
          className="p-1"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{weekLabel(week.start)}</span>
          {week.isCurrent && (
            <Badge className="border-transparent bg-primary text-white">
              This week
            </Badge>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="small"
          disabled={selected >= upperBound}
          onClick={() => setSelected((i) => Math.min(upperBound, i + 1))}
          aria-label="Next week"
          className="p-1"
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
      {week.tasks.length > 0 ? (
        <ul className="border-border border-t">
          {week.tasks.map((task, index) => (
            <CampaignStrategyTaskRow
              key={task.id}
              task={task}
              index={index + 1}
              onToggleComplete={onToggleComplete}
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground border-border border-t px-6 py-4 text-sm">
          No tasks scheduled for this week.
        </p>
      )}
    </div>
  )
}

// "Done" is plain green text; the other states are pills.
const PhaseStatus = ({
  status,
}: {
  status: CampaignStrategyPhaseModel['status']
}): React.JSX.Element => {
  if (status === 'done') {
    return <span className="text-success-700 text-sm font-semibold">Done</span>
  }
  if (status === 'active') {
    return (
      <Badge className="border-transparent bg-primary text-white">
        Happening now
      </Badge>
    )
  }
  return (
    <Badge className="text-muted-foreground border-border bg-transparent">
      Coming up
    </Badge>
  )
}

// One phase as a standalone card (active phase gets a blue border). Title and
// summary stay visible when collapsed; objective/category groups and task rows
// run edge to edge so dividers and highlights reach the card sides.
const CampaignStrategyPhase = ({
  phase,
  onToggleComplete,
}: CampaignStrategyPhaseProps): React.JSX.Element => (
  <AccordionItem
    value={phase.key}
    className={cn(
      'bg-card overflow-hidden rounded-xl border px-0 shadow-sm',
      phase.status === 'active' && 'border-primary',
    )}
  >
    <AccordionTrigger className="px-6 py-5 hover:no-underline">
      <span className="flex flex-1 flex-col gap-1 text-left">
        <span className="flex items-center gap-3">
          <span className="text-base font-semibold">{phase.title}</span>
          <PhaseStatus status={phase.status} />
        </span>
        <span className="text-muted-foreground text-sm font-normal">
          {phase.summary}
        </span>
      </span>
    </AccordionTrigger>
    <AccordionContent>
      {phase.gate?.kind === 'window' ? (
        <div className="border-border border-t px-6 py-4">
          <div className="bg-primary/10 text-primary flex items-start gap-2 rounded-lg px-4 py-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            {phase.gate.message}
          </div>
        </div>
      ) : phase.weeks && phase.weeks.length > 0 ? (
        <WeekNavigator
          weeks={phase.weeks}
          onToggleComplete={onToggleComplete}
        />
      ) : (
        phase.groups.map((group) => (
          <div key={group.key}>
            {group.label && (
              <div className="bg-muted border-border border-t px-6 py-3">
                <p className="text-primary text-xs font-semibold tracking-wide uppercase">
                  {group.label}
                </p>
              </div>
            )}
            <ul className={cn(!group.label && 'border-border border-t')}>
              {group.tasks.map((task, index) => (
                <CampaignStrategyTaskRow
                  key={task.id}
                  task={task}
                  index={index + 1}
                  onToggleComplete={onToggleComplete}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </AccordionContent>
  </AccordionItem>
)

export default CampaignStrategyPhase
