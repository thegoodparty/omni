import { Stepper, cn } from '@styleguide'
import {
  PRIORITY_NUMBERED_STEPS,
  PRIORITY_STAGE_LABELS,
  PRIORITY_STEP_CAPTIONS,
  PRIORITY_STEP_LABELS,
  PRIORITY_STEP_STAGE,
  priorityStepNumber,
  type PriorityFlowStep,
} from '../data/steps'

// Wizard progress plus the current step's question. The stage name carries the
// shape of the whole thing (understand, weigh, decide, do) so a step never
// feels like an errand with no context.
export default function PriorityStepper({
  current,
}: {
  current: PriorityFlowStep
}): React.JSX.Element {
  const stepNumber = priorityStepNumber(current)
  const stage = PRIORITY_STEP_STAGE[current]

  return (
    <div className="flex flex-col gap-2">
      {stepNumber !== null ? (
        <Stepper
          currentStep={stepNumber}
          totalSteps={PRIORITY_NUMBERED_STEPS.length}
        />
      ) : null}
      <span
        className={cn(
          'text-sm font-semibold uppercase tracking-wide',
          current === 'track' ? 'text-muted-foreground' : 'text-primary',
        )}
      >
        {PRIORITY_STAGE_LABELS[stage]}
      </span>
      <h1 className="text-xl font-semibold text-foreground">
        {PRIORITY_STEP_LABELS[current]}
      </h1>
      <p className="text-sm text-muted-foreground">
        {PRIORITY_STEP_CAPTIONS[current]}
      </p>
    </div>
  )
}
