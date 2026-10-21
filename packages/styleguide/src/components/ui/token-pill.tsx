import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

// The chip a merge tag renders as. Shared with `TokenField`'s in-editor pill,
// so a preview or a review step shows the same pill the composer does.
export const tokenPillClassName =
  'inline-flex items-center rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary-dark'

function TokenPill({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="token-pill"
      className={cn(tokenPillClassName, className)}
      {...props}
    />
  )
}

export { TokenPill }
