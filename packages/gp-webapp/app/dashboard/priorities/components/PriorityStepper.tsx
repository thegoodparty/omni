import { Stepper } from '@styleguide'
import {
  PRIORITY_NUMBERED_STEPS,
  PRIORITY_STAGE_LABELS,
  PRIORITY_STEP_SHORT_LABELS,
  PRIORITY_STEP_STAGE,
  priorityStepNumber,
  type PriorityFlowStep,
} from '../data/steps'

// Wizard progress: the segmented bar plus the stage and step, the same shape
// OrdinanceStepper uses. Track is a standing step, not a numbered one, so it
// shows only its label.
export default function PriorityStepper({
  current,
}: {
  current: PriorityFlowStep
}): React.JSX.Element {
  const stepNumber = priorityStepNumber(current)

  return (
    <div className="flex flex-col gap-2">
      {stepNumber !== null ? (
        <Stepper
          currentStep={stepNumber}
          totalSteps={PRIORITY_NUMBERED_STEPS.length}
        />
      ) : null}
      <span className="text-sm font-semibold uppercase tracking-wide text-primary">
        {PRIORITY_STAGE_LABELS[PRIORITY_STEP_STAGE[current]]}
        {' · '}
        {PRIORITY_STEP_SHORT_LABELS[current]}
      </span>
    </div>
  )
}
