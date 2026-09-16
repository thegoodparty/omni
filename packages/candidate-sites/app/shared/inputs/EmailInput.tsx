'use client'

import { useState, ChangeEvent, FocusEvent } from 'react'
import TextField from './TextField'
import { isValidEmail } from '../../../helpers/validations'

// NOTE: leaving export here for now to not break existing imports
export { isValidEmail }

interface EmailInputProps {
  value: string
  onChangeCallback: (e: ChangeEvent<HTMLInputElement>) => void
  onBlurCallback?: (
    e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void
  className?: string
  placeholder?: string
  useLabel?: boolean
  required?: boolean
  accentColor?: string
  'data-testid'?: string
}

export default function EmailInput({
  value,
  onChangeCallback,
  onBlurCallback,
  className,
  placeholder,
  useLabel = true,
  required,
  accentColor,
  'data-testid': dataTestId,
}: EmailInputProps) {
  const [isValid, setIsValid] = useState(true)

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const newValue = e.target.value
    setIsValid(isValidEmail(newValue))
    // Cast is safe: an EmailInput never renders a textarea.
    onChangeCallback(e as ChangeEvent<HTMLInputElement>)
  }

  const hasError = value !== '' && !isValid

  return (
    <TextField
      type="email"
      value={value}
      label={useLabel ? 'Email' : undefined}
      required={required}
      name="email"
      error={hasError}
      endAdornments={hasError ? ['error'] : undefined}
      onChange={handleChange}
      onBlur={onBlurCallback}
      className={className}
      placeholder={placeholder || ''}
      accentColor={accentColor}
      data-testid={dataTestId}
    />
  )
}
