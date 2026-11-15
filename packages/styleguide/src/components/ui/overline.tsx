import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

interface OverlineProps extends React.ComponentProps<'p'> {
  // When false, the overline drops its primary-blue emphasis and inherits
  // the surrounding card's foreground color. Reserved for surfaces that
  // use the overline as a quiet category tag rather than a lead-in the
  // eye should catch (ContentCard's dimmed variant).
  emphasis?: boolean
}

/**
 * Existing overlines above card titles (TaskCard) predate the rule, so don't
 * copy them. If an item needs a tag, use one Badge that says something specific
 * to it.
 *
 * @summary Use rarely, for a tiny uppercase label. Rule 19 in learned.md says no
 * overlines above headings or card titles; let the title lead.
 */
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
