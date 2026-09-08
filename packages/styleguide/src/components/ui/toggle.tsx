'use client'

import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@styleguide/lib/utils'

const toggleVariants = cva(
  "text-foreground inline-flex items-center justify-center gap-2 rounded-md border border-transparent text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow] outline-none hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:border-base-border focus-visible:ring-primary-focus focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border-components-input-border',
        // Independent pill chips (ENG-11070) — unlike outline's equal-width
        // segmented control, each item hugs its own label. The rest of the
        // pill look (rounded-full, selected fill) can't live in this
        // mutually-exclusive variant map because ToggleGroupItem's base
        // class string (rounded-md, data-[state=on]:bg-background) is
        // always present regardless of variant; overriding it needs the
        // higher-specificity data-[variant=pills]: compound selectors in
        // toggle-group.tsx, the same mechanism the outline variant uses.
        pills: 'border-components-input-border bg-transparent',
      },
      size: {
        default: 'h-9 px-2 min-w-9',
        sm: 'h-8 px-1.5 min-w-8',
        lg: 'h-10 px-2.5 min-w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
