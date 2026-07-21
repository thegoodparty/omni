'use client'

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'

import { cn } from '@styleguide/lib/utils'
import { CheckIcon } from './icons'
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
        'aspect-square size-5 shrink-0 rounded-full border border-components-input-border bg-components-input-base outline-none',
        'transition-[border-color,border-width,box-shadow]',
        'focus-visible:ring-[3px] focus-visible:ring-components-input-focus',
        'aria-invalid:border-destructive focus-visible:aria-invalid:ring-[3px] focus-visible:aria-invalid:ring-destructive-focus',
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
        variant="secondary"
        className="flex cursor-pointer flex-col items-start gap-px peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
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
  titleClassName?: string
  // 'check': the circle fills with the primary color and shows a check mark
  // when selected, instead of the default radio dot.
  indicator?: 'radio' | 'check'
  disabled?: boolean
}

function RadioCardItem({
  value,
  id,
  title,
  description,
  className,
  titleClassName,
  indicator = 'radio',
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
        className={cn(
          'shrink-0 disabled:opacity-100',
          indicator === 'check' &&
            'border-2 text-primary-foreground data-[state=checked]:border-2 data-[state=checked]:bg-primary',
        )}
      >
        {indicator === 'check' && (
          <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
            <CheckIcon className="size-3" />
          </RadioGroupPrimitive.Indicator>
        )}
      </RadioGroupItem>
      <div className="flex flex-col gap-px">
        <span
          className={cn(
            'text-sm font-normal leading-5 text-foreground',
            titleClassName,
          )}
        >
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
