'use client'

import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'

import { cn } from '@styleguide/lib/utils'
import { CheckIcon } from './icons'
import { Label } from './label'

/**
 * Always pass a defined value; "" means nothing selected. Use
 * RadioGroupItemLabel for each labeled option. Pre-select a default when most
 * people pick the same one.
 *
 * @summary Use for picking one of up to about five visible options. For more
 * options, use Combobox; never a Select for two or three.
 */
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

// The whole card is the radio, so a press anywhere on it selects. A <label>
// card around a small radio depends on the browser forwarding the click,
// which can stop at moving focus and take a second press.
/**
 * The whole card is the radio, so don't wrap it in a label or add a click
 * handler.
 *
 * @summary Use for picking one of a few options shown as cards with a title and
 * short description. Place inside a RadioGroup; for plain options, use
 * RadioGroupItemLabel.
 */
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
    <RadioGroupPrimitive.Item
      data-slot="radio-card-item"
      value={value}
      id={id}
      disabled={disabled}
      aria-labelledby={
        description ? `${id}-title ${id}-description` : `${id}-title`
      }
      className={cn(
        'group/radio-card flex w-full cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-components-input-focus',
        'data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex aspect-square size-5 shrink-0 items-center justify-center rounded-full border border-components-input-border bg-components-input-base',
          'transition-[border-color,border-width,background-color]',
          'group-data-[state=checked]/radio-card:border-primary',
          indicator === 'radio' &&
            'group-data-[state=checked]/radio-card:border-[6px]',
          indicator === 'check' &&
            'border-2 text-primary-foreground group-data-[state=checked]/radio-card:bg-primary',
        )}
      >
        {indicator === 'check' && (
          <CheckIcon className="hidden size-3 group-data-[state=checked]/radio-card:block" />
        )}
      </span>
      <span className="flex flex-col gap-px">
        <span
          id={`${id}-title`}
          className={cn(
            'text-sm font-normal leading-5 text-foreground',
            titleClassName,
          )}
        >
          {title}
        </span>
        {description && (
          <span
            id={`${id}-description`}
            className="text-xs text-muted-foreground"
          >
            {description}
          </span>
        )}
      </span>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, RadioGroupItemLabel, RadioCardItem }
