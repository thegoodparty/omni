'use client'

import React, { useState, useEffect } from 'react'
import { AsYouType } from 'libphonenumber-js'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import PhoneIcon from '@mui/icons-material/Phone'
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
  shrink?: boolean
  required?: boolean
  className?: string
  placeholder?: string
  useLabel?: boolean
  disabled?: boolean
  sx?: any
  InputLabelProps?: any
}

function PhoneInput({
  value = '',
  onChangeCallback,
  onBlurCallback = () => {},
  hideIcon,
  shrink,
  required = false,
  className,
  placeholder,
  useLabel = true,
  disabled,
  sx,
  InputLabelProps,
  ...restProps
}: PhoneInputProps) {
  const [displayValue, setDisplayValue] = useState(value || '')
  const [validPhone, setValidPhone] = useState(true)

  useEffect(() => {
    if (value !== displayValue) {
      setDisplayValue(value || '')
    }
  }, [value])

  const onChangeValue = (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value
    const asYouType = new AsYouType('US')
    const formatted = asYouType.input(inputValue)

    setDisplayValue(formatted)
    setValidPhone(isValidPhone(inputValue))
    onChangeCallback(formatted)
  }

  const onBlurChange = () => {
    setValidPhone(isValidPhone(displayValue))
    onBlurCallback()
  }

  return (
    <TextField
      className={className}
      value={displayValue}
      label={useLabel ? 'Phone' : ''}
      size="medium"
      fullWidth
      name="phone"
      onChange={onChangeValue}
      onBlur={onBlurChange}
      variant="outlined"
      error={!validPhone && displayValue !== ''}
      required={required}
      placeholder={placeholder || ''}
      disabled={disabled}
      sx={sx}
      InputProps={
        !hideIcon
          ? {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton>
                    <PhoneIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }
          : {}
      }
      InputLabelProps={
        shrink || InputLabelProps
          ? {
              shrink: true,
              ...InputLabelProps,
            }
          : {}
      }
      {...restProps}
    />
  )
}

export default PhoneInput
