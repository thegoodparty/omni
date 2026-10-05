import { Stepper } from '@styleguide'
import type { OrdinanceFlowStep } from '@goodparty_org/contracts'
import {
  ORDINANCE_NUMBERED_STEPS,
  ORDINANCE_STEP_LABELS,
  ordinanceStepNumber,
} from '../data/steps'

// Wizard progress: the segmented bar + "Step N of 5" for a numbered step, then
// the current step's name. Intro is an entry point, not a numbered step, so it
// shows only the label.
export default function OrdinanceStepper({
  current,
}: {
  current: OrdinanceFlowStep
}): React.JSX.Element {
  const stepNumber = ordinanceStepNumber(current)

  return (
    <div className="flex flex-col gap-2">
      {stepNumber !== null ? (
        <Stepper
          currentStep={stepNumber}
          totalSteps={ORDINANCE_NUMBERED_STEPS.length}
        />
      ) : null}
      <span className="text-sm font-semibold uppercase tracking-wide text-primary">
        {ORDINANCE_STEP_LABELS[current]}
      </span>
    </div>
  )
}
