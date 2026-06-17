import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@styleguide/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center border [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden w-fit whitespace-nowrap shrink-0 font-medium text-xs',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-white [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        soft: 'border-transparent bg-grayscale-200 text-foreground [a&]:hover:bg-grayscale-200/70',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'text-foreground [a&]:hover:bg-base-accent [a&]:hover:text-base-accent-foreground',
      },
      shape: {
        default: 'rounded-md px-2.5 py-1',
        pill: 'rounded-full h-5 min-w-5 px-1.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      shape: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  shape,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, shape }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
