import * as React from 'react'

import { cn } from '@styleguide/lib/utils'

const Eyebrow = ({ className, ...props }: React.ComponentProps<'p'>) => (
  <p
    data-slot="eyebrow"
    className={cn(
      'text-primary flex items-center gap-1 text-xs font-bold uppercase [&_svg]:size-4',
      className,
    )}
    {...props}
  />
)

export { Eyebrow }
