'use client'

import Link from 'next/link'
import ButtonLoading from './ButtonLoading'
import { forwardRef, ReactNode, MouseEventHandler } from 'react'

export const COLOR_CLASSES = {
  primary:
    'text-white bg-blue-600 hover:[&:not([disabled])]:bg-blue-700 focus-visible:outline-blue-600/30 active:outline-blue-600/30',
  secondary:
    'text-white bg-gray-600 hover:[&:not([disabled])]:bg-gray-700 focus-visible:outline-gray-600/40 active:outline-gray-600/40',
  tertiary:
    'text-white bg-purple-600 hover:[&:not([disabled])]:bg-purple-700 focus-visible:outline-purple-600/30 active:outline-purple-600/30',
  error:
    'text-white bg-red-600 hover:[&:not([disabled])]:bg-red-700 focus-visible:outline-red-600/30 active:outline-red-600/30',
  warning:
    'text-black bg-yellow-400 hover:[&:not([disabled])]:bg-yellow-500 focus-visible:outline-yellow-400/30 active:outline-yellow-400/30',
  info: 'text-white bg-cyan-600 hover:[&:not([disabled])]:bg-cyan-700 focus-visible:outline-cyan-600/30 active:outline-cyan-600/30',
  success:
    'text-white bg-green-600 hover:[&:not([disabled])]:bg-green-700 focus-visible:outline-green-600/30 active:outline-green-600/30',
  neutral:
    'text-gray-700 bg-gray-200 hover:[&:not([disabled])]:bg-gray-300 focus-visible:outline-gray-300/40 active:outline-gray-300/40',
  white:
    'text-black bg-white hover:[&:not([disabled])]:bg-gray-100 focus-visible:outline-white/40 active:outline-white/40 border border-gray-300',
}

const OUTLINED_COLOR_CLASSES = {
  primary:
    'text-blue-600 !border-blue-600/50 hover:[&:not([disabled])]:bg-blue-600/[0.08] focus-visible:!bg-blue-600/[0.12] active:!bg-blue-600/[0.12]',
  secondary:
    'text-gray-600 !border-gray-600/50 hover:[&:not([disabled])]:bg-gray-600/[0.16] focus-visible:bg-gray-600/[0.24] active:!bg-gray-600/[0.24]',
  tertiary:
    'text-purple-600 !border-purple-600/50 hover:[&:not([disabled])]:bg-purple-600/[0.08] focus-visible:!bg-purple-600/[0.12] active:!bg-purple-600/[0.12]',
  error:
    'text-red-600 !border-red-600/50 hover:[&:not([disabled])]:bg-red-600/[0.08] focus-visible:!bg-red-600/[0.12] active:!bg-red-600/[0.12]',
  warning:
    'text-yellow-600 !border-yellow-600/50 hover:[&:not([disabled])]:bg-yellow-600/[0.08] focus-visible:!bg-yellow-600/[0.12] active:!bg-yellow-600/[0.12]',
  info: 'text-cyan-600 !border-cyan-600/50 hover:[&:not([disabled])]:bg-cyan-600/[0.08] focus-visible:!bg-cyan-600/[0.12] active:!bg-cyan-600/[0.12]',
  success:
    'text-green-600 !border-green-600/50 hover:[&:not([disabled])]:bg-green-600/[0.08] focus-visible:!bg-green-600/[0.12] active:!bg-green-600/[0.12]',
  neutral:
    'text-gray-600 !border-gray-600/60 hover:[&:not([disabled])]:bg-gray-600/[0.16] focus-visible:!bg-gray-600/[0.24] active:!bg-gray-600/[0.24]',
}

const TEXT_COLOR_CLASSES = {
  primary:
    'text-blue-600 hover:[&:not([disabled])]:bg-blue-600/[0.08] focus-visible:!bg-blue-600/[0.12] active:!bg-blue-600/[0.12]',
  secondary:
    'text-gray-600 hover:[&:not([disabled])]:bg-gray-600/[0.16] focus-visible:!bg-gray-600/[0.24] active:!bg-gray-600/[0.24]',
  tertiary:
    'text-purple-600 hover:[&:not([disabled])]:bg-purple-600/[0.08] focus-visible:!bg-purple-600/[0.12] active:!bg-purple-600/[0.12]',
  error:
    'text-red-600 hover:[&:not([disabled])]:bg-red-600/[0.08] focus-visible:!bg-red-600/[0.12] active:!bg-red-600/[0.12]',
  warning:
    'text-yellow-600 hover:[&:not([disabled])]:bg-yellow-600/[0.08] focus-visible:!bg-yellow-600/[0.12] active:!bg-yellow-600/[0.12]',
  info: 'text-cyan-600 hover:[&:not([disabled])]:bg-cyan-600/[0.08] focus-visible:!bg-cyan-600/[0.12] active:!bg-cyan-600/[0.12]',
  success:
    'text-green-600 hover:[&:not([disabled])]:bg-green-600/[0.08] focus-visible:!bg-green-600/[0.12] active:!bg-green-600/[0.12]',
  neutral:
    'text-gray-600 hover:[&:not([disabled])]:bg-gray-600/[0.16] focus-visible:!bg-gray-600/[0.24] active:!bg-gray-600/[0.24]',
}

export const VARIANT_CLASSES = {
  contained: COLOR_CLASSES,
  outlined: OUTLINED_COLOR_CLASSES,
  text: TEXT_COLOR_CLASSES,
}

export const SIZE_CLASSES = {
  small: 'text-xs py-2 px-3',
  medium: 'text-sm py-[10px] px-4',
  large: 'text-base py-3 px-6 leading-6',
}

interface ButtonProps {
  href?: string
  target?: string
  nativeLink?: boolean
  size?: keyof typeof SIZE_CLASSES
  variant?: keyof typeof VARIANT_CLASSES
  color?: keyof typeof COLOR_CLASSES
  children: ReactNode
  className?: string
  loading?: boolean
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>
  type?: 'button' | 'submit' | 'reset'
  [key: string]: any
}

/**
 * Component for all button variants/colors
 */
const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  (
    {
      href,
      target,
      nativeLink = false,
      size = 'medium',
      variant = 'contained',
      color = 'primary',
      children,
      className,
      loading,
      disabled,
      ...restProps
    },
    ref,
  ) => {
    let baseClasses =
      'rounded-lg text-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors no-underline outline-offset-0 inline-block'

    if (variant !== 'text') baseClasses += ' border-2 border-transparent '

    if (variant === 'contained')
      baseClasses += ' outline outline-4 outline-transparent'

    const variantClasses = VARIANT_CLASSES[variant as keyof typeof VARIANT_CLASSES] || VARIANT_CLASSES.contained
    const colorClasses = variantClasses[color as keyof typeof variantClasses] || variantClasses.primary
    const sizeClasses = SIZE_CLASSES[size as keyof typeof SIZE_CLASSES] || SIZE_CLASSES.medium

    const compiledClassName = `${baseClasses} ${sizeClasses} ${colorClasses} ${
      className || ''
    }`

    // render a disabled button instead of link if disabled = true
    if (href && !disabled) {
      if (nativeLink) {
        // use native <a> tag if nativeLink = true
        return (
          <a
            href={href}
            target={target}
            className={compiledClassName}
            ref={ref as any}
            {...restProps}
          >
            {children}
          </a>
        )
      }
      return (
        <Link
          href={href}
          target={target}
          className={compiledClassName}
          ref={ref as any}
          {...restProps}
        >
          {children}
        </Link>
      )
    }

    return (
      <button
        type="button"
        className={compiledClassName}
        disabled={disabled}
        ref={ref as any}
        {...restProps}
      >
        {loading === true && (
          <ButtonLoading size={size} className="align-text-bottom" />
        )}

        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'

export default Button
