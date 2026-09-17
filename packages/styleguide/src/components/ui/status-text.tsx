import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@styleguide/lib/utils'

const statusTextVariants = cva(
  'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        primary: 'text-primary',
        info: 'text-info',
        success: 'text-success',
        warning: 'text-warning',
        destructive: 'text-destructive',
        muted: 'text-muted-foreground',
      },
    },
    defaultVariants: {
      tone: 'primary',
    },
  },
)

interface StatusTextProps
  extends
    React.ComponentProps<'span'>,
    VariantProps<typeof statusTextVariants> {
  icon?: React.ReactNode
  spinning?: boolean
}

const StatusText = ({
  icon,
  spinning = false,
  tone,
  className,
  children,
  ...props
}: StatusTextProps) => (
  <span
    data-slot="status-text"
    className={cn(statusTextVariants({ tone }), className)}
    {...props}
  >
    {icon ? (
      <span
        data-slot="status-text-icon"
        className={cn('inline-flex shrink-0', spinning && 'animate-spin')}
      >
        {icon}
      </span>
    ) : null}
    {children}
  </span>
)

export { StatusText, statusTextVariants, type StatusTextProps }
