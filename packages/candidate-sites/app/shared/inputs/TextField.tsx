'use client'

import {
  ChangeEvent,
  CSSProperties,
  FocusEvent,
  ReactElement,
  ReactNode,
  useId,
} from 'react'
import { AlertCircle } from 'lucide-react'

// Named adornment keys the callers use — kept as a string vocabulary so
// the ContactSection code that reads `endAdornments={['error']}` still works.
const ADORNMENTS: Record<string, ReactNode> = {
  error: <AlertCircle className="h-4 w-4 text-error" aria-hidden="true" />,
}

type AdornmentKey = keyof typeof ADORNMENTS

interface TextFieldProps {
  value?: string
  defaultValue?: string
  label?: string
  name?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  error?: boolean
  helperText?: ReactNode
  multiline?: boolean
  rows?: number
  className?: string
  // Site-theme accent color applied to the label, focus ring, and focused
  // border. A single hex string rather than a runtime style block, since the
  // color varies per candidate site and can't be a Tailwind class.
  accentColor?: string
  endAdornments?: (AdornmentKey | ReactElement)[]
  onChange?: (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void
  onBlur?: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onFocus?: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  type?: string
  autoComplete?: string
  'data-testid'?: string
  id?: string
}

/**
 * Plain input with a label above the field, an optional accent color for the
 * label + focus states, `multiline` (renders a textarea) and `endAdornments`
 * (a keyed 'error' icon or an inline ReactElement).
 */
export default function TextField({
  value,
  defaultValue,
  label,
  name,
  placeholder,
  required,
  disabled,
  error,
  helperText,
  multiline,
  rows = 4,
  className,
  accentColor,
  endAdornments,
  onChange,
  onBlur,
  onFocus,
  type = 'text',
  autoComplete,
  'data-testid': dataTestId,
  id,
}: TextFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId

  const labelStyle: CSSProperties | undefined = accentColor
    ? { color: error ? undefined : accentColor }
    : undefined
  // Accent color is applied via inline style on the border so it can hold a
  // theme-driven arbitrary hex; the focus/hover states use a CSS variable
  // read by the same rule.
  const borderStyle: CSSProperties | undefined =
    accentColor && !error
      ? ({
          borderColor: accentColor,
          ['--tw-ring-color' as string]: accentColor,
        } as CSSProperties)
      : undefined

  const baseFieldClasses =
    'block w-full rounded-md border bg-white px-3 py-2.5 text-base text-gray-900 placeholder-gray-400 shadow-sm outline-none transition-colors focus:ring-2 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50'
  const stateClasses = error
    ? 'border-error focus:border-error focus:ring-error/40'
    : 'border-gray-300 focus:ring-primary/40'

  const adornmentNodes = endAdornments?.length
    ? endAdornments.map((adornment, index) => (
        <span key={index} className="ml-2 inline-flex shrink-0 items-center">
          {typeof adornment === 'string'
            ? (ADORNMENTS[adornment] ?? adornment)
            : adornment}
        </span>
      ))
    : null

  return (
    <div className={className}>
      {label ? (
        <label
          htmlFor={fieldId}
          className={`mb-1.5 block text-sm font-medium ${error ? 'text-error' : 'text-gray-700'}`}
          style={labelStyle}
        >
          {label}
          {required ? ' *' : null}
        </label>
      ) : null}
      <div className="relative flex items-center">
        {multiline ? (
          <textarea
            id={fieldId}
            name={name}
            value={value}
            defaultValue={defaultValue}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            rows={rows}
            onChange={onChange}
            onBlur={onBlur}
            onFocus={onFocus}
            autoComplete={autoComplete}
            data-testid={dataTestId}
            style={borderStyle}
            className={`${baseFieldClasses} ${stateClasses} resize-y`}
          />
        ) : (
          <input
            id={fieldId}
            type={type}
            name={name}
            value={value}
            defaultValue={defaultValue}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            onChange={onChange}
            onBlur={onBlur}
            onFocus={onFocus}
            autoComplete={autoComplete}
            data-testid={dataTestId}
            style={borderStyle}
            className={`${baseFieldClasses} ${stateClasses} ${adornmentNodes ? 'pr-10' : ''}`}
          />
        )}
        {adornmentNodes ? (
          <div className="pointer-events-none absolute right-3 flex items-center">
            {adornmentNodes}
          </div>
        ) : null}
      </div>
      {helperText ? (
        <p className={`mt-1 text-xs ${error ? 'text-error' : 'text-gray-500'}`}>
          {helperText}
        </p>
      ) : null}
    </div>
  )
}
