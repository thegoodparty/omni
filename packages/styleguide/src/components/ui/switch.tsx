'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@styleguide/lib/utils'
import { Label } from '@styleguide/components/ui/label'

type SwitchSide = 'left' | 'right'

type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root>

function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent',
        'transition-[color,box-shadow] outline-none',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground',
        'focus-visible:ring-[3px] focus-visible:ring-components-input-focus',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background transition-transform data-[state=checked]:translate-x-full"
      />
    </SwitchPrimitive.Root>
  )
}

interface SwitchLabelProps extends SwitchProps {
  id: string
  label: string
  description?: string
  side?: SwitchSide
  className?: string
  switchClassName?: string
}

function SwitchLabel({
  label,
  description,
  side = 'left',
  id,
  className,
  switchClassName,
  disabled,
  ...props
}: SwitchLabelProps) {
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <div
      data-slot="switch-label"
      data-disabled={disabled ? 'true' : undefined}
      className={cn(
        'group flex w-full items-start gap-2',
        side === 'right' && 'flex-row-reverse',
        className,
      )}
    >
      <Switch
        id={id}
        aria-describedby={descriptionId}
        className={cn('shrink-0', switchClassName)}
        disabled={disabled}
        {...props}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <Label
          htmlFor={id}
          className="cursor-pointer font-normal leading-5 text-foreground"
        >
          {label}
        </Label>
        {description && (
          <p
            id={descriptionId}
            className={cn(
              'text-xs text-muted-foreground',
              disabled && 'opacity-50',
            )}
          >
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

type SwitchBoxProps = SwitchLabelProps

function SwitchBox({ className, switchClassName, ...props }: SwitchBoxProps) {
  return (
    <div
      data-slot="switch-box"
      className={cn(
        'bg-card border-base-border rounded-base border p-4',
        className,
      )}
    >
      <SwitchLabel switchClassName={switchClassName} {...props} />
    </div>
  )
}

export { Switch, SwitchLabel, SwitchBox }
export type { SwitchSide }
