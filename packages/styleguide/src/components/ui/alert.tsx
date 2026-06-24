import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@styleguide/lib/utils'

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm grid gap-y-0.5 items-start bg-background',
  {
    variants: {
      variant: {
        default:
          'border-tertiary text-tertiary-dark [&>svg]:text-tertiary-dark',
        info: 'border-info text-info-dark [&>svg]:text-info-dark',
        success: 'border-success text-success-dark [&>svg]:text-success-dark',
        destructive:
          'border-destructive text-destructive-dark [&>svg]:text-destructive-dark',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const alertAccentVars: Record<
  string,
  { '--alert-accent': string; '--alert-accent-fg': string }
> = {
  default: {
    '--alert-accent': 'var(--color-tertiary-dark)',
    '--alert-accent-fg': 'var(--color-tertiary-foreground)',
  },
  info: {
    '--alert-accent': 'var(--color-info-dark)',
    '--alert-accent-fg': 'var(--color-info-contrast)',
  },
  success: {
    '--alert-accent': 'var(--color-success-dark)',
    '--alert-accent-fg': 'var(--color-success-contrast)',
  },
  destructive: {
    '--alert-accent': 'var(--color-destructive-dark)',
    '--alert-accent-fg': 'var(--color-destructive-foreground)',
  },
}

interface AlertProps
  extends React.ComponentProps<'div'>, VariantProps<typeof alertVariants> {
  icon?: React.ReactNode
}

function Alert({
  className,
  variant,
  icon,
  children,
  style,
  ...props
}: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      style={
        {
          ...alertAccentVars[variant ?? 'default'],
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        alertVariants({ variant }),
        icon
          ? 'grid-cols-[calc(var(--spacing)*4)_1fr] gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5'
          : 'grid-cols-[0_1fr]',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight',
        className,
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-sm opacity-90 [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        'col-start-2 mt-2 min-[600px]:col-start-3 min-[600px]:mt-0 min-[600px]:row-start-1 min-[600px]:row-span-2 min-[600px]:self-center',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
