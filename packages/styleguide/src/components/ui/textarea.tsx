import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-components-input-border text-foreground placeholder:text-muted-foreground focus:border-components-input-active focus-visible:ring-components-input-focus aria-invalid:border-destructive focus:aria-invalid:border-destructive focus-visible:aria-invalid:ring-destructive-focus flex min-h-16 w-full rounded-md border bg-components-input-base px-3 py-2 text-base transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
