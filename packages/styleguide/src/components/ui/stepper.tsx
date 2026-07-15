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
  size?: 'small' | 'medium'
  className?: string
}

type StepperProps = BarStepperProps | VerticalStepperProps
type VerticalStepperSize = NonNullable<VerticalStepperProps['size']>

// Mirrors Avatar's size -> indicator/text pairing (small: size-8/text-xs,
// medium: size-10/text-sm) so the two circular indicators in the design
// system stay on the same scale.
const verticalSizeClasses: Record<
  VerticalStepperSize,
  { item: string; indicator: string; label: string }
> = {
  small: {
    item: 'gap-2 px-3 py-2',
    indicator: 'size-8 text-xs',
    label: 'text-xs',
  },
  medium: {
    item: 'gap-3 px-4 py-3',
    indicator: 'size-10 text-sm',
    label: 'text-sm',
  },
}

function Stepper(props: StepperProps) {
  if (props.variant === 'vertical') {
    const { currentStep, labels, size = 'medium', className } = props
    const sizeClasses = verticalSizeClasses[size]
    return (
      <ol
        data-slot="stepper"
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
              data-slot="stepper-item"
              aria-current={isActive ? 'step' : undefined}
              // Completed steps are announced as such but render identically
              // to upcoming ones: the Figma "steps" component set defines only
              // active/default variants, so there is no completed visual to
              // apply.
              aria-label={isCompleted ? `${label} - completed` : undefined}
              className={cn(
                'flex items-center rounded-full transition-colors',
                sizeClasses.item,
                isActive && 'bg-muted',
              )}
            >
              <span
                data-slot="stepper-indicator"
                aria-hidden="true"
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full font-medium transition-colors',
                  sizeClasses.indicator,
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-tertiary-light text-tertiary-dark',
                )}
              >
                {stepNumber}
              </span>
              <span
                data-slot="stepper-label"
                className={cn(
                  'leading-5 text-foreground',
                  sizeClasses.label,
                  isActive && 'font-medium',
                )}
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
    )
  }

  const { currentStep, totalSteps, showLabel = true, className } = props
  return (
    <div
      data-slot="stepper"
      className={cn('space-y-3', className)}
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuenow={currentStep}
    >
      {showLabel && (
        <div
          data-slot="stepper-counter"
          className="flex justify-end text-sm font-medium text-muted-foreground"
        >
          Step {currentStep} of {totalSteps}
        </div>
      )}
      <div
        data-slot="stepper-track"
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: totalSteps }, (_, index) => (
          <div
            key={index}
            data-slot="stepper-segment"
            className={cn(
              'h-1.5 rounded-full transition-colors',
              index < currentStep ? 'bg-primary' : 'bg-primary/20',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export {
  type StepperVariant,
  type BarStepperProps,
  type VerticalStepperProps,
  Stepper,
}
