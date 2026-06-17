'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon } from './icons'

import { cn } from '@styleguide/lib/utils'
import { Label } from './label'

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer border-components-input-border dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-base-focus-ring data-[state=checked]:focus-visible:border-components-input-active focus-visible:ring-components-input-focus aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4.5 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

interface CheckboxLabelProps extends React.ComponentProps<
  typeof CheckboxPrimitive.Root
> {
  id: string
  label: string
  description?: string
  checkboxClassName?: string
}

function CheckboxLabel({
  id,
  label,
  description,
  className,
  checkboxClassName,
  disabled,
  ...props
}: CheckboxLabelProps) {
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <div
      data-slot="checkbox-label"
      data-disabled={disabled ? 'true' : undefined}
      className={cn('group flex items-start gap-2', className)}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Checkbox
          id={id}
          aria-describedby={descriptionId}
          disabled={disabled}
          className={checkboxClassName}
          {...props}
        />
      </span>
      <div className="flex flex-col gap-px">
        <Label
          htmlFor={id}
          className="cursor-pointer font-normal leading-5 text-foreground"
        >
          {label}
        </Label>
        {description && (
          <p
            id={descriptionId}
            className="text-xs text-muted-foreground group-data-[disabled=true]:opacity-50"
          >
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

export { Checkbox, CheckboxLabel }
