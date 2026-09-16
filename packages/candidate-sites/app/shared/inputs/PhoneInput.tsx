'use client'

import { useState, ChangeEvent } from 'react'
import { AsYouType } from 'libphonenumber-js'
import { Phone } from 'lucide-react'
import TextField from './TextField'

export const isValidPhone = (phone: string): boolean => {
  if (!phone) {
    return false
  }
  const formattedPhone = phone.replace(/\D/g, '')
  return (
    formattedPhone.length === 10 ||
    (formattedPhone.length === 11 && formattedPhone.charAt(0) === '1')
  )
}

interface PhoneInputProps {
  value?: string
  onChangeCallback: (phone: string) => void
  onBlurCallback?: () => void
  hideIcon?: boolean
  required?: boolean
  className?: string
  placeholder?: string
  useLabel?: boolean
  disabled?: boolean
  accentColor?: string
}

function PhoneInput({
  value = '',
  onChangeCallback,
  onBlurCallback = () => {},
  hideIcon,
  required = false,
  className,
  placeholder,
  useLabel = true,
  disabled,
  accentColor,
}: PhoneInputProps) {
  const [validPhone, setValidPhone] = useState(true)
  const displayValue = value || ''

  const onChangeValue = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const inputValue = event.target.value
    const asYouType = new AsYouType('US')
    const formatted = asYouType.input(inputValue)

    setValidPhone(isValidPhone(inputValue))
    onChangeCallback(formatted)
  }

  const onBlurChange = () => {
    setValidPhone(isValidPhone(displayValue))
    onBlurCallback()
  }

  const hasError = !validPhone && displayValue !== ''

  return (
    <TextField
      type="tel"
      className={className}
      value={displayValue}
      label={useLabel ? 'Phone' : undefined}
      name="phone"
      onChange={onChangeValue}
      onBlur={onBlurChange}
      error={hasError}
      required={required}
      placeholder={placeholder || ''}
      disabled={disabled}
      accentColor={accentColor}
      endAdornments={
        hideIcon
          ? undefined
          : [
              <Phone
                key="phone"
                className="h-4 w-4 text-gray-500"
                aria-hidden="true"
              />,
            ]
      }
    />
  )
}

export default PhoneInput
