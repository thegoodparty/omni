'use client'

import { useState, type ComponentType } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
  cn,
} from '@styleguide'
import {
  ChevronLeftIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  TriangleAlertIcon,
} from '@styleguide/components/ui/icons'
import {
  PRIORITY_STEP_LABELS,
  PRIORITY_STEP_PURPOSE,
  type PriorityCheckState,
  type PriorityStatus,
  type PriorityStep,
  type PriorityStepCheck,
  type PriorityStepId,
  type PriorityStepState,
} from '@goodparty_org/contracts'

interface StatePresentation {
  label: string
  icon: ComponentType<{ className?: string }>
  iconClassName: string
  chipClassName: string
}

// State has to read at a glance, so it is carried by an icon and a colour
// first and by the word second.
export const STEP_STATE_PRESENTATION: Record<
  PriorityStepState,
  StatePresentation
> = {
  open: {
    label: 'Not started',
    icon: CircleIcon,
    iconClassName: 'text-muted-foreground/60',
    chipClassName: 'bg-muted text-muted-foreground border-border',
  },
  active: {
    label: 'Working on it',
    icon: CircleDotIcon,
    iconClassName: 'text-primary',
    chipClassName: 'bg-primary/10 text-primary border-primary/30',
  },
  settled: {
    label: 'Done',
    icon: CircleCheckIcon,
    iconClassName: 'text-success',
    chipClassName: 'bg-success/10 text-success border-success/30',
  },
  stale: {
    label: 'Needs another look',
    icon: TriangleAlertIcon,
    iconClassName: 'text-warning',
    chipClassName: 'bg-warning/10 text-warning border-warning/40',
  },
}

export const StepStateIcon = ({
  state,
  className,
}: {
  state: PriorityStepState
  className?: string
}): React.JSX.Element => {
  const { icon: Icon, iconClassName } = STEP_STATE_PRESENTATION[state]
  return <Icon className={cn('size-4 shrink-0', iconClassName, className)} />
}

const StepStateChip = ({
  state,
}: {
  state: PriorityStepState
}): React.JSX.Element => {
  const { label, chipClassName } = STEP_STATE_PRESENTATION[state]
  return (
    <Badge variant="outline" className={cn('text-xs', chipClassName)}>
      {label}
    </Badge>
  )
}

// Whether the people a step lands on have been heard from. Shown because an
// unchecked conclusion should never read the same as a checked one.
export const STEP_CHECK_LABELS: Record<PriorityCheckState, string> = {
  asked: 'Waiting on you: check with constituents',
  out: 'Waiting to hear back',
  confirmed: 'Constituents agreed',
  revised: 'Changed after hearing from constituents',
  deferred: 'Checking with constituents later',
  declined: 'Not checked with constituents',
}

// One line per step, whichever side it is about. The main side leads: once
// it is out with people, that is the line, even if the other side is still
// waiting on a yes.
const checkLineState = (check: PriorityStepCheck): PriorityCheckState => {
  if (check.state === 'asked') return 'asked'
  if (check.state === 'out' || check.contrast?.state === 'out') return 'out'
  if (check.contrast?.state === 'asked') return 'asked'
  return check.state
}

const StepCheckLine = ({
  step,
}: {
  step: PriorityStep
}): React.JSX.Element | null =>
  step.check ? (
    <span className="block text-xs text-muted-foreground">
      {STEP_CHECK_LABELS[checkLineState(step.check)]}
    </span>
  ) : null

const changedOn = (step: PriorityStep): string | null => {
  if (!step.updatedAt) return null
  const parsed = new Date(step.updatedAt)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

const StepDetail = ({
  step,
  onBack,
}: {
  step: PriorityStep
  onBack: () => void
}): React.JSX.Element => {
  const changed = changedOn(step)
  return (
    <div className="flex flex-col gap-3 p-4">
      <Button
        variant="ghost"
        size="small"
        onClick={onBack}
        className="-ml-2 h-auto w-fit gap-1 px-2 py-1 text-xs"
      >
        <ChevronLeftIcon className="size-3.5" aria-hidden />
        All steps
      </Button>
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground">
            {PRIORITY_STEP_LABELS[step.id]}
          </p>
          <StepStateChip state={step.state} />
        </div>
        <p className="text-xs text-muted-foreground">
          {PRIORITY_STEP_PURPOSE[step.id]}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {step.summary || 'Nothing here yet.'}
      </p>
      <StepCheckLine step={step} />
      {step.caveat ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm text-foreground">{step.caveat}</p>
        </div>
      ) : null}
      {changed ? (
        <p className="text-xs text-muted-foreground">Last changed {changed}</p>
      ) : null}
    </div>
  )
}

const StepList = ({
  steps,
  onSelect,
}: {
  steps: PriorityStep[]
  onSelect: (id: PriorityStepId) => void
}): React.JSX.Element => (
  <ul className="divide-y divide-border">
    {steps.map((step) => (
      <li key={step.id}>
        {/* The check line sits under the label visually, but it describes the
            step rather than naming it, so it is announced after the name. */}
        <button
          type="button"
          onClick={() => onSelect(step.id)}
          aria-labelledby={`step-${step.id}-label step-${step.id}-state`}
          {...(step.check && { 'aria-describedby': `step-${step.id}-check` })}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40"
        >
          <StepStateIcon state={step.state} />
          <span
            className={cn(
              'flex-1 text-sm',
              step.state === 'open' && 'text-muted-foreground',
            )}
          >
            <span id={`step-${step.id}-label`}>
              {PRIORITY_STEP_LABELS[step.id]}
            </span>
            <span id={`step-${step.id}-check`} className="block">
              <StepCheckLine step={step} />
            </span>
          </span>
          <span id={`step-${step.id}-state`}>
            <StepStateChip state={step.state} />
          </span>
        </button>
      </li>
    ))}
  </ul>
)

/**
 * The whole path, always visible. Every step is listed whatever its state, so
 * the official can see where the work has been as well as where it is; a row
 * opens what that step settled and what is still in doubt.
 */
export const PriorityStatusRail = ({
  status,
  nextAction,
  className,
}: {
  status: PriorityStatus
  nextAction: string | null
  className?: string
}): React.JSX.Element => {
  const [selectedId, setSelectedId] = useState<PriorityStepId | null>(null)
  const selected = status.steps.find((step) => step.id === selectedId) ?? null
  const settled = status.steps.filter((step) => step.state === 'settled').length

  return (
    <Card className={cn('gap-0 py-0', className)}>
      <CardHeader className="gap-1 px-4 pt-4 pb-3">
        <CardTitle className="text-sm">Where this stands</CardTitle>
        <CardDescription className="text-xs">
          {`${settled} of ${status.steps.length} done`}
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="px-0">
        {selected ? (
          <StepDetail step={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <StepList steps={status.steps} onSelect={setSelectedId} />
        )}
      </CardContent>
      {nextAction ? (
        <>
          <Separator />
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground">Next</p>
            <p className="text-sm text-foreground">{nextAction}</p>
          </div>
        </>
      ) : null}
    </Card>
  )
}
