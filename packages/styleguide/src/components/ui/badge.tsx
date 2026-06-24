import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@styleguide/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center border [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow,background-color] overflow-hidden w-fit whitespace-nowrap shrink-0 font-medium text-xs',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/80 dark:[a&]:hover:bg-primary/70 [button&]:hover:bg-primary/80 dark:[button&]:hover:bg-primary/70',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80 dark:[a&]:hover:bg-secondary/70 [button&]:hover:bg-secondary/80 dark:[button&]:hover:bg-secondary/70 focus-visible:ring-secondary/50',
        soft: 'border-transparent bg-grayscale-200 dark:bg-grayscale-800 text-foreground [a&]:hover:bg-grayscale-200/70 dark:[a&]:hover:bg-grayscale-700 [button&]:hover:bg-grayscale-200/70 dark:[button&]:hover:bg-grayscale-700 dark:focus-visible:ring-primary/50',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/80 dark:[a&]:hover:bg-destructive/70 [button&]:hover:bg-destructive/80 dark:[button&]:hover:bg-destructive/70 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'text-foreground [a&]:hover:bg-base-accent [a&]:hover:text-base-accent-foreground [button&]:hover:bg-base-accent [button&]:hover:text-base-accent-foreground',
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
