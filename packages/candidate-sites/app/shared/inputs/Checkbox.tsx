'use client'

import * as RadixCheckbox from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { CSSProperties } from 'react'

interface CheckboxProps {
  id?: string
  name?: string
  label?: string
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (event: {
    target: { checked: boolean; name?: string; value?: string }
  }) => void
  disabled?: boolean
  required?: boolean
  className?: string
  // Site-theme accent color, applied to the checked-state fill and the
  // focus ring. Replaces the MUI `theme.muiColor` prop.
  theme?: {
    muiColor?: string
  }
}

const Checkbox = ({
  id,
  name,
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  required,
  className,
  theme,
}: CheckboxProps) => {
  const color = theme?.muiColor
  const style: CSSProperties | undefined = color
    ? { backgroundColor: 'transparent', borderColor: color }
    : undefined
  const checkedStyle: CSSProperties | undefined = color
    ? { backgroundColor: color, borderColor: color }
    : undefined

  const control = (
    <RadixCheckbox.Root
      id={id}
      name={name}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      required={required}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-500 bg-white transition-colors data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${className || ''}`}
      style={checked ? checkedStyle : style}
      onCheckedChange={(state) => {
        // Preserves the shape callers already pass (`onChange({ target: { checked } })`
        // mirroring the MUI input event surface).
        onChange?.({
          target: { checked: state === true, name },
        })
      }}
    >
      <RadixCheckbox.Indicator className="text-white">
        <Check className="h-4 w-4" strokeWidth={3} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )

  if (!label) return control

  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-2"
    >
      {control}
      <span>{label}</span>
    </label>
  )
}

export default Checkbox
