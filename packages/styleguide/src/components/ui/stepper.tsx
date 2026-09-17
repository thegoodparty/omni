'use client'

import type { ReactNode } from 'react'
import { cn } from '@styleguide/lib/utils'
import { Button } from './button'
import { Overline } from './overline'
import { XMarkIcon } from './icons'

type StepperVariant = 'bar' | 'vertical'

interface BarStepperProps {
  variant?: 'bar'
  currentStep: number
  totalSteps: number
  // Optional overline slot — the flow's identity in the header row. A
  // channel badge in outreach, a logo in onboarding, or a flow name like
  // "Create new list" in a wizard drawer. Omit for a bars-only render.
  // A string is wrapped in the shared <Overline> component; pass a
  // ReactNode to render your own markup (badge, logo, etc.) verbatim.
  overline?: ReactNode
  // Optional Exit affordance. When defined, renders the Exit button in
  // the header row's right slot. Omit for surfaces with no exit
  // (onboarding) or whose sheet chrome carries its own close (CRM
  // wizard, team invite drawer).
  onExit?: () => void
  className?: string
  // Optional per-segment class override. The default is the chunky bar
  // consumers standardized on; a caller that needs a different height/
  // shape can pass its own without forking the component. Rare.
  barClassName?: string
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
                isActive && 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full',
                  isActive
                    ? 'bg-foreground text-background'
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

  const { currentStep, totalSteps, overline, onExit, className, barClassName } =
    props
  const hasHeaderRow = overline !== undefined || onExit !== undefined
  return (
    <div className={cn(className)}>
      {/* Header row: overline slot + Exit button. Both are optional and
          the whole row disappears when neither is set, so a caller that
          only wants the bars gets exactly that. */}
      {hasHeaderRow && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {typeof overline === 'string' ? (
              <Overline>{overline}</Overline>
            ) : (
              overline
            )}
          </div>
          {onExit && (
            <Button
              type="button"
              variant="ghost"
              size="small"
              aria-label="Exit"
              onClick={onExit}
            >
              <XMarkIcon className="size-[18px]" />
              Exit
            </Button>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label="Progress"
        // valuemin is 0, not 1: the WAI-ARIA percentage screen readers
        // announce is (valuenow - valuemin) / (valuemax - valuemin), so
        // valuemin=1 made step 1 of 5 announce as 0% instead of 20%.
        // valuetext overrides that percentage with a human sentence —
        // the retired visible label put back for assistive tech alone.
        aria-valuemin={0}
        aria-valuemax={totalSteps}
        aria-valuenow={currentStep}
        aria-valuetext={`Step ${currentStep} of ${totalSteps}`}
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: totalSteps }, (_, index) => (
          <div
            key={index}
            className={cn(
              'h-2.5 rounded-full',
              barClassName,
              index < currentStep ? 'bg-components-input-active' : 'bg-border',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export { Stepper, type StepperVariant }
