'use client'

import { cn } from '@styleguide/lib/utils'

type StepperVariant = 'bar' | 'vertical'

interface BarStepperProps {
  variant?: 'bar'
  currentStep: number
  totalSteps: number
  showLabel?: boolean
  className?: string
}

interface VerticalStepperProps {
  variant: 'vertical'
  currentStep: number
  labels: string[]
  className?: string
}

type StepperProps = BarStepperProps | VerticalStepperProps

function Stepper(props: StepperProps) {
  if (props.variant === 'vertical') {
    const { currentStep, labels, className } = props
    return (
      <ol
        className={cn('flex flex-col gap-2', className)}
        aria-label="Progress"
      >
        {labels.map((label, index) => {
          const stepNumber = index + 1
          const isActive = stepNumber === currentStep
          const isCompleted = stepNumber < currentStep
          return (
            <li
              key={label}
              aria-current={isActive ? 'step' : undefined}
              // Completed steps are announced as such but render identically
              // to upcoming ones: the Figma "steps" component set defines only
              // active/default variants, so there is no completed visual to
              // apply.
              aria-label={isCompleted ? `${label} - completed` : undefined}
              className={cn(
                'flex items-center gap-3 rounded-full px-4 py-3',
                isActive && 'bg-slate-200',
              )}
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full',
                  isActive
                    ? 'bg-slate-600 text-base-foreground-dark'
                    : 'bg-tertiary-light text-tertiary-dark',
                )}
              >
                {stepNumber}
              </span>
              {label}
            </li>
          )
        })}
      </ol>
    )
  }

  const { currentStep, totalSteps, showLabel = true, className } = props
  return (
    <div
      className={cn('space-y-3', className)}
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuenow={currentStep}
    >
      {showLabel && (
        <div className="flex justify-end text-sm font-medium text-muted-foreground">
          Step {currentStep} of {totalSteps}
        </div>
      )}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: totalSteps }, (_, index) => (
          <div
            key={index}
            className={cn(
              'h-1.5 rounded-full',
              index < currentStep
                ? 'bg-components-input-active'
                : 'bg-slate-200',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export { Stepper, type StepperVariant }
