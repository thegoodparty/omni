'use client'

import {
  InputAdornment,
  TextField as MuiTextField,
  TextFieldProps as MuiTextFieldProps,
} from '@mui/material'
import { ErrorOutlineRounded } from '@mui/icons-material'
import { ReactElement } from 'react'

const ADORNMENTS = {
  error: <ErrorOutlineRounded className="text-red" />,
}

interface TextFieldProps extends Omit<MuiTextFieldProps, 'endAdornments'> {
  endAdornments?: (keyof typeof ADORNMENTS | ReactElement)[]
}

/**
 * Wrapper around MuiTextField component
 */
export default function TextField({ endAdornments, ...restProps }: TextFieldProps) {
  return (
    <MuiTextField
      variant="outlined"
      InputProps={{
        endAdornment: endAdornments?.length && endAdornments.length > 0 && (
          <InputAdornment position="end">
            {endAdornments.map(
              (adornment, index) => (
                <span key={index}>
                  {ADORNMENTS[adornment as keyof typeof ADORNMENTS] ?? adornment}
                </span>
              )
            )}
          </InputAdornment>
        ),
        ...restProps?.InputProps, // ensure adornment shorthand doesn't override any other InputProps
      }}
      {...restProps}
    />
  )
} 