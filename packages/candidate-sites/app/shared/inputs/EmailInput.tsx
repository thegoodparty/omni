'use client'

import { useState, ChangeEvent } from 'react'
import TextField from './TextField'
import { isValidEmail } from '../../../helpers/validations'
import { TextFieldProps } from '@mui/material'

// NOTE: leaving export here for now to not break existing imports
export { isValidEmail }

interface EmailInputProps extends Omit<TextFieldProps, 'onChange' | 'onChangeCallback'> {
  value: string
  onChangeCallback: (e: ChangeEvent<HTMLInputElement>) => void
  onBlurCallback?: (e: any) => void
  shrink?: boolean
  className?: string
  placeholder?: string
  useLabel?: boolean
  required?: boolean
  newCallbackSignature?: boolean
  'data-testid'?: string
}

export default function EmailInput({
  value,
  onChangeCallback,
  onBlurCallback,
  shrink,
  className,
  placeholder,
  useLabel = true,
  required,
  newCallbackSignature = false,
  ...restProps
}: EmailInputProps) {
  const [isValid, setIsValid] = useState(true)

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value
    const emailValid = isValidEmail(newValue)

    setIsValid(emailValid)

    if (newCallbackSignature) {
      // For new callback signature, we'd need to modify the callback type
      // For now, keeping it simple
      onChangeCallback(e)
    } else {
      onChangeCallback(e)
    }
  }

  return (
    <TextField
      value={value}
      label={useLabel ? 'Email' : ''}
      required={required}
      size="medium"
      fullWidth
      name="email"
      error={value !== '' && !isValid}
      onChange={handleChange}
      onBlur={onBlurCallback}
      className={className}
      placeholder={placeholder || ''}
      InputLabelProps={
        shrink
          ? {
              shrink: true,
            }
          : {}
      }
      inputProps={{
        'data-testid': restProps['data-testid'],
      }}
      {...restProps}
    />
  )
} 