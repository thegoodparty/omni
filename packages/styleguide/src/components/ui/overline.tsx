import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

interface OverlineProps extends React.ComponentProps<'p'> {
  // When false, the overline drops its primary-blue emphasis and inherits
  // the surrounding card's foreground color. Reserved for surfaces that
  // use the overline as a quiet category tag rather than a lead-in the
  // eye should catch (ContentCard's dimmed variant).
  emphasis?: boolean
}

const Overline = ({ className, emphasis = true, ...props }: OverlineProps) => (
  <p
    data-slot="overline"
    className={cn(
      'text-xs font-bold uppercase',
      emphasis ? 'text-primary' : 'text-card-foreground',
      className,
    )}
    {...props}
  />
)

export { Overline, type OverlineProps }
