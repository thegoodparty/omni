'use client'

import { useEffect, useState } from 'react'
import { Progress } from '@styleguide'
import {
  GlobeIcon,
  ListChecksIcon,
  Loader2Icon,
  ScaleIcon,
  SearchIcon,
} from '@styleguide/components/ui/icons'

// The cosmetic step sequence. These advance on a timer independent of the real
// collection/summary run — there are no backend events to wire them to. The
// timer drives the label/counter; the real poll (in RaceOpponentList) decides
// when to leave this screen.
const STEPS = [
  { label: 'Researching ballot data', Icon: SearchIcon },
  { label: 'Identifying candidate website', Icon: GlobeIcon },
  { label: 'Analyzing strengths and weaknesses', Icon: ScaleIcon },
  { label: 'Compiling actions to take', Icon: ListChecksIcon },
] as const

const STEP_INTERVAL_MS = 4000

type Props = {
  // True once the real run has completed and data is present. Drives the
  // terminal "ready" state. The cosmetic timer NEVER flips this on its own — it
  // holds on the last step until the real run lands, so the user is never told
  // "ready" before there's a report to show.
  ready?: boolean
}

const OpponentResearchProgress = ({
  ready = false,
}: Props): React.JSX.Element => {
  // Index of the active cosmetic step. Holds on the last step (length - 1)
  // rather than claiming completion, so a fast timer can't out-run a slow run.
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (ready) return
    const id = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1))
    }, STEP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [ready])

  // Completed-step count: the cosmetic steps before the active one while
  // running; all four once the real run is ready.
  const completed = ready ? STEPS.length : stepIndex
  // stepIndex is clamped to [0, STEPS.length - 1] and STEPS is a non-empty
  // tuple, so STEPS[0] is the safe fallback for the indexed-access check.
  const current = STEPS[stepIndex] ?? STEPS[0]
  const ActiveIcon = current.Icon
  const progressValue = (completed / STEPS.length) * 100

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-8">
      <header className="flex flex-col gap-1 text-center">
        <h2 className="text-lg font-semibold text-foreground">
          {ready
            ? 'Your opponent report is ready'
            : 'Researching your opponents'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {ready
            ? "We've finished compiling everything. Opening your report…"
            : "This usually takes under a minute. We'll keep working in the background."}
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <Progress value={progressValue} />
        <span className="text-xs font-medium text-muted-foreground">
          {completed} of {STEPS.length} steps complete
        </span>
      </div>

      <div
        className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3"
        aria-live="polite"
      >
        {ready ? (
          <ListChecksIcon
            className="size-5 shrink-0 text-success-dark"
            aria-hidden
          />
        ) : (
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            <Loader2Icon
              className="absolute size-5 animate-spin text-primary"
              aria-hidden
            />
            <ActiveIcon className="size-3 text-primary" aria-hidden />
          </span>
        )}
        <span className="text-sm font-medium text-foreground">
          {ready ? 'Wrapping up' : current.label}
        </span>
      </div>
    </div>
  )
}

export default OpponentResearchProgress
