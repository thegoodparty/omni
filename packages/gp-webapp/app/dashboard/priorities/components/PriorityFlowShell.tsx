'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, FilterPill, FilterPillGroup, cn } from '@styleguide'
import { ChevronLeftIcon } from '@styleguide/components/ui/icons'
import type { Priority } from '@goodparty_org/contracts'
import {
  PRIORITY_NEXT_STEP_CTA,
  PRIORITY_NUMBERED_STEPS,
  PRIORITY_STEP_SHORT_LABELS,
  isPriorityStep,
  nextPriorityStep,
  type PriorityFlowStep,
} from '../data/steps'
import PriorityStepper from './PriorityStepper'
import StepPanel from './StepPanel'

// The flow around one priority. Step state lives here for now: the flow's
// backend does not exist, so nothing is persisted and a reload starts over.
// When gp-api owns the record, `step` comes from it and this becomes a route
// param, the way the ordinance flow does it.
export default function PriorityFlowShell({
  priority,
}: {
  priority: Priority
}): React.JSX.Element {
  const [step, setStep] = useState<PriorityFlowStep>('define')
  const destination = nextPriorityStep(step)

  // House rule for multi-step flows: a step change puts the user back at the
  // top, or they land mid-card on a screen they have not read.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  const reached = (candidate: PriorityFlowStep): boolean => {
    const current = PRIORITY_NUMBERED_STEPS.indexOf(step)
    const other = PRIORITY_NUMBERED_STEPS.indexOf(candidate)
    if (current === -1 || other === -1) return false
    return other <= current
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/priorities"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" aria-hidden />
          All priorities
        </Link>
        <h2 className="text-base font-semibold text-foreground">
          {priority.title}
        </h2>
      </div>

      <FilterPillGroup
        aria-label="Steps"
        value={step}
        onValueChange={(value) => {
          if (isPriorityStep(value)) setStep(value)
        }}
      >
        {PRIORITY_NUMBERED_STEPS.map((candidate) => (
          <FilterPill
            key={candidate}
            value={candidate}
            className={cn(
              'text-xs',
              // A step already worked reads as done; one still ahead stays
              // quiet, so the rail shows progress and not just position.
              candidate !== step &&
                (reached(candidate) ? 'bg-muted' : 'text-muted-foreground'),
            )}
          >
            {PRIORITY_STEP_SHORT_LABELS[candidate]}
          </FilterPill>
        ))}
      </FilterPillGroup>

      <PriorityStepper current={step} />

      <StepPanel
        step={step}
        onAdvance={destination ? () => setStep(destination) : null}
        advanceLabel={
          destination ? PRIORITY_NEXT_STEP_CTA[destination] : 'Done'
        }
      />

      {step !== 'track' ? (
        <Button
          variant="ghost"
          size="small"
          className="self-start"
          onClick={() => setStep('track')}
        >
          Where does this stand?
        </Button>
      ) : null}
    </div>
  )
}
