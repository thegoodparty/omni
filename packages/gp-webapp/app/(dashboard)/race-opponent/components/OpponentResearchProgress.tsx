'use client'

import { useEffect, useState } from 'react'
import { Progress } from '@styleguide'
import { CheckIcon, Loader2Icon } from '@styleguide/components/ui/icons'

// The cosmetic step sequence. These advance on a timer independent of the real
// collection/summary run — there are no backend events to wire them to. The
// timer drives the label/counter; the real poll (in RaceOpponentList) decides
// when to leave this screen.
const STEPS = [
  'Researching ballot data',
  'Identifying candidate website',
  'Analyzing strengths and weaknesses',
  'Compiling actions to take',
] as const

// Each step spins while working, then flashes a checkmark before the next step
// begins. Working + done sums to the previous single 4s-per-step cadence.
const STEP_WORKING_MS = 3500
const STEP_DONE_MS = 500

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
  // Whether the active step is showing its brief completed checkmark before the
  // next step begins.
  const [stepDone, setStepDone] = useState(false)

  useEffect(() => {
    if (ready) return
    let timer: ReturnType<typeof setTimeout>
    // Each step spins, flashes its check, then advances — the next step is
    // scheduled from inside the timer callback (not an effect re-run) so the
    // chain stays self-contained. The last step schedules nothing: it holds on
    // its spinner until the real run flips `ready`, so the timer alone never
    // shows a completed check or claims the run is done.
    const scheduleStep = (index: number) => {
      if (index >= STEPS.length - 1) return
      timer = setTimeout(() => {
        setStepDone(true)
        timer = setTimeout(() => {
          setStepIndex(index + 1)
          setStepDone(false)
          scheduleStep(index + 1)
        }, STEP_DONE_MS)
      }, STEP_WORKING_MS)
    }
    scheduleStep(0)
    return () => clearTimeout(timer)
  }, [ready])

  // Completed-step count: the cosmetic steps before the active one while
  // running; all four once the real run is ready.
  const completed = ready ? STEPS.length : stepIndex
  // stepIndex is clamped to [0, STEPS.length - 1] and STEPS is a non-empty
  // tuple, so the indexed access always resolves; STEPS[0] is a safe fallback
  // for the noUncheckedIndexedAccess check.
  const label = ready ? STEPS[STEPS.length - 1] : (STEPS[stepIndex] ?? STEPS[0])
  const showCheck = ready || stepDone
  const progressValue = (completed / STEPS.length) * 100

  return (
    <div className="mx-auto w-full max-w-[608px]">
      <header className="text-center">
        <h2 className="text-lg font-semibold text-foreground sm:text-2xl">
          {ready
            ? 'Your opponent report is ready'
            : 'Researching your opponents'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {ready
            ? "We've finished compiling everything. Opening your report…"
            : "This usually takes under a minute. We'll keep working in the background."}
        </p>
      </header>

      <div className="mt-8">
        <Progress value={progressValue} />
        <p className="mt-2 text-center text-xs font-medium text-muted-foreground">
          {completed} of {STEPS.length} steps complete
        </p>
      </div>

      <div
        className="mt-8 flex items-center justify-center gap-3"
        aria-live="polite"
      >
        {showCheck ? (
          <CheckIcon className="size-5 shrink-0 text-success" aria-hidden />
        ) : (
          <Loader2Icon
            className="size-5 shrink-0 animate-spin text-primary"
            aria-hidden
          />
        )}
        <span className="text-base font-medium text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  )
}

export default OpponentResearchProgress
