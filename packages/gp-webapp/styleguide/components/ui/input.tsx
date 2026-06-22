'use client'

import * as React from 'react'
import { cn } from '@styleguide/lib/utils'

interface InputProps extends React.ComponentProps<'input'> {
  icon?: React.ReactNode
}

function Input({ className, type, icon, ...props }: InputProps) {
  if (icon) {
    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&>svg]:size-4">
          {icon}
        </span>
        <input
          type={type}
          data-slot="input"
          className={cn(
            'text-foreground file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-components-input-border flex items-center h-10 w-full min-w-0 rounded-md border bg-components-input-base py-2 pr-3 pl-9 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-full file:items-center file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            'focus:border-components-input-active focus-visible:ring-[3px] focus-visible:ring-components-input-focus',
            'aria-invalid:border-destructive focus:aria-invalid:border-destructive focus-visible:aria-invalid:ring-destructive-focus',
            className,
          )}
          {...props}
        />
      </div>
    )
  }

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'text-foreground file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-components-input-border flex items-center h-10 w-full min-w-0 rounded-md border bg-components-input-base px-3 py-2 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-full file:items-center file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus:border-components-input-active focus-visible:ring-[3px] focus-visible:ring-components-input-focus',
        'aria-invalid:border-destructive focus:aria-invalid:border-destructive focus-visible:aria-invalid:ring-destructive-focus',
        className,
      )}
      {...props}
    />
  )
}

export { Input, type InputProps }
