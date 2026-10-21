import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@styleguide/lib/utils'

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'bg-primary/20 relative h-3 w-full overflow-hidden rounded-full',
        className,
      )}
      {...props}
    >
      {/* Hidden at 0%: slid fully out, its anti-aliased edge still bleeds a
          hairline into the track's rounded corner, reading as progress.
          Faded rather than unmounted, so the first step still animates in. */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'bg-primary h-full w-full flex-1 rounded-full transition-all',
          !value && 'opacity-0',
        )}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
