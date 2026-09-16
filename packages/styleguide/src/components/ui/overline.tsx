import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

const Overline = ({ className, ...props }: React.ComponentProps<'p'>) => (
  <p
    data-slot="overline"
    className={cn('text-primary text-xs font-bold uppercase', className)}
    {...props}
  />
)

export { Overline }
