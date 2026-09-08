'use client'

import * as React from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { type VariantProps } from 'class-variance-authority'

import { cn } from '@styleguide/lib/utils'
import { toggleVariants } from './toggle'

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: 'default',
  variant: 'default',
})

function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        'group/toggle-group flex w-fit items-center gap-1 data-[variant=outline]:gap-0 data-[variant=pills]:flex-wrap data-[variant=pills]:gap-2',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        'shadow-none focus:z-10 focus-visible:z-10 data-[variant=outline]:min-w-0 data-[variant=outline]:flex-1 data-[variant=outline]:shrink-0 data-[variant=outline]:rounded-none data-[variant=outline]:first:rounded-l-md data-[variant=outline]:last:rounded-r-md data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l data-[variant=outline]:bg-muted data-[variant=outline]:data-[state=on]:bg-background',
        // Pills (ENG-11070): each chip hugs its label — no min-w-0/flex-1,
        // no merged segment borders — and never clips regardless of item
        // count or label length. rounded-full and the selected fill have to
        // beat the base cva string's rounded-md/data-[state=on]:bg-background
        // on specificity, hence the compound data-[variant=pills]:data-[state=on]
        // selectors below, mirroring the outline override above.
        'data-[variant=pills]:w-fit data-[variant=pills]:shrink-0 data-[variant=pills]:rounded-full data-[variant=pills]:px-3 data-[variant=pills]:data-[state=on]:border-foreground data-[variant=pills]:data-[state=on]:bg-foreground data-[variant=pills]:data-[state=on]:text-background data-[variant=pills]:data-[state=on]:hover:text-background',
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
