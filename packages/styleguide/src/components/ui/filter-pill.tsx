'use client'

import * as React from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { cn } from '@styleguide/lib/utils'
import { XMarkIcon } from './icons'

const pillClass = cn(
  'inline-flex items-center justify-center rounded-full border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground transition-colors',
  'hover:bg-muted',
  'data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90',
  'outline-none focus-visible:ring-[3px] focus-visible:ring-tertiary-focus',
  'disabled:pointer-events-none disabled:opacity-50',
)

const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']

type SingleToggleGroupProps = Extract<
  React.ComponentProps<typeof ToggleGroupPrimitive.Root>,
  { type: 'single' }
>

type MultipleToggleGroupProps = Extract<
  React.ComponentProps<typeof ToggleGroupPrimitive.Root>,
  { type: 'multiple' }
>

type FilterPillGroupProps =
  | (Omit<SingleToggleGroupProps, 'type'> & { type?: 'single' })
  | (Omit<MultipleToggleGroupProps, 'type'> & { type: 'multiple' })

function FilterPillGroup({
  className,
  children,
  onValueChange,
  type = 'single',
  ...props
}: FilterPillGroupProps) {
  const sharedClass = cn('flex flex-wrap gap-2', className)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(e.key)) return
    setTimeout(() => {
      const focused = document.activeElement as HTMLElement | null
      const value = focused?.getAttribute('data-value') ?? ''
      if (value) (onValueChange as ((v: string) => void) | undefined)?.(value)
    }, 0)
  }

  if (type === 'multiple') {
    const multiProps = props as Omit<
      MultipleToggleGroupProps,
      'type' | 'className' | 'onValueChange'
    >
    return (
      <ToggleGroupPrimitive.Root
        type="multiple"
        className={sharedClass}
        onValueChange={
          onValueChange as MultipleToggleGroupProps['onValueChange']
        }
        {...multiProps}
      >
        {children}
      </ToggleGroupPrimitive.Root>
    )
  }

  const singleProps = props as Omit<
    SingleToggleGroupProps,
    'type' | 'className' | 'onValueChange'
  >
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      className={sharedClass}
      onKeyDown={handleKeyDown}
      onValueChange={onValueChange as SingleToggleGroupProps['onValueChange']}
      {...singleProps}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  )
}

type FilterPillProps = React.ComponentProps<
  typeof ToggleGroupPrimitive.Item
> & {
  onRemove?: () => void
}

function FilterPill({
  className,
  children,
  value,
  onRemove,
  ...props
}: FilterPillProps) {
  return (
    <ToggleGroupPrimitive.Item
      data-value={value}
      value={value}
      className={cn(pillClass, onRemove && 'pr-2', className)}
      {...props}
    >
      {children}
      {onRemove && (
        // ToggleGroupPrimitive.Item renders as <button>; a nested <button> is
        // invalid HTML. <span role="button"> preserves keyboard accessibility
        // without violating the interactive-in-interactive constraint.
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation()
              onRemove()
            }
          }}
          className="ml-1.5 inline-flex items-center justify-center rounded-full outline-none hover:opacity-70 focus-visible:ring-[3px] focus-visible:ring-tertiary-focus"
          aria-label="Remove"
        >
          <XMarkIcon className="size-3" />
        </span>
      )}
    </ToggleGroupPrimitive.Item>
  )
}

export { FilterPillGroup, FilterPill }
export type { FilterPillGroupProps, FilterPillProps }
