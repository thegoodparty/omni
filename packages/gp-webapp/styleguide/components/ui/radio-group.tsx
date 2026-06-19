'use client'

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'

import { cn } from '@styleguide/lib/utils'
import { Label } from './label'

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-5 shrink-0 rounded-full border border-border bg-background outline-none',
        'transition-[border-color,border-width,box-shadow]',
        'focus-visible:ring-[3px] focus-visible:ring-primary-focus',
        'aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-[6px] data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    />
  )
}

interface RadioGroupItemLabelProps extends React.ComponentProps<
  typeof RadioGroupPrimitive.Item
> {
  id: string
  label: string
  description?: string
}

function RadioGroupItemLabel({
  id,
  label,
  description,
  className,
  disabled,
  ...props
}: RadioGroupItemLabelProps) {
  return (
    <div className="flex items-start gap-2">
      <RadioGroupItem
        id={id}
        className={cn('peer shrink-0', className)}
        disabled={disabled}
        {...props}
      />
      <Label
        htmlFor={id}
        className="flex cursor-pointer flex-col items-start gap-px font-normal leading-5 text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
      >
        <span>{label}</span>
        {description && (
          <span className="text-xs font-normal text-muted-foreground">
            {description}
          </span>
        )}
      </Label>
    </div>
  )
}

interface RadioCardItemProps {
  value: string
  id: string
  title: string
  description?: string
  className?: string
  disabled?: boolean
}

function RadioCardItem({
  value,
  id,
  title,
  description,
  className,
  disabled,
}: RadioCardItemProps) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-3 transition-colors',
        'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-card has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary',
        'has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-50',
        className,
      )}
    >
      <RadioGroupItem
        value={value}
        id={id}
        disabled={disabled}
        className="shrink-0 disabled:opacity-100"
      />
      <div className="flex flex-col gap-px">
        <span className="text-sm font-normal leading-5 text-foreground">
          {title}
        </span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
    </Label>
  )
}

export { RadioGroup, RadioGroupItem, RadioGroupItemLabel, RadioCardItem }
