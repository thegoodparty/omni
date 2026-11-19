'use client'

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'

import { cn } from '@styleguide/lib/utils'

interface LabelProps extends React.ComponentProps<typeof LabelPrimitive.Root> {
  variant?: 'primary' | 'secondary'
}

/**
 * Add "(optional)" to optional fields; never put an asterisk on required ones. A
 * question on a form page is a Label, not a heading.
 *
 * @summary Use for the visible name of a form field, linked to it with htmlFor.
 * For a checkbox or switch with its label, use CheckboxLabel or SwitchLabel.
 */
function Label({ className, variant = 'primary', ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-5 text-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        variant === 'primary' ? 'font-medium' : 'font-normal',
        className,
      )}
      {...props}
    />
  )
}

export { Label, type LabelProps }
