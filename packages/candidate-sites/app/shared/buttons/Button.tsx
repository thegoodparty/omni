'use client'

import Link from 'next/link'
import ButtonLoading from './ButtonLoading'
import { forwardRef, ReactNode, MouseEventHandler } from 'react'

export const COLOR_CLASSES = {
  primary:
    'text-primary-contrast bg-primary-main hover:[&:not([disabled])]:bg-primary-dark focus-visible:outline-primary-main/30 active:outline-primary-main/30',
  secondary:
    'text-secondary-contrast bg-secondary-main hover:[&:not([disabled])]:bg-secondary-dark focus-visible:outline-secondary-dark/40 active:outline-secondary-dark/40',
  tertiary:
    'text-tertiary-contrast bg-tertiary-main hover:[&:not([disabled])]:bg-tertiary-dark focus-visible:outline-tertiary-dark/30 active:outline-tertiary-dark/30',
  error:
    'text-error-contrast bg-error-main hover:[&:not([disabled])]:bg-error-dark focus-visible:outline-error-main/30 active:outline-error-main/30',
  warning:
    'text-warning-contrast bg-warning-main hover:[&:not([disabled])]:bg-warning-dark focus-visible:outline-warning-main/30 active:outline-warning-main/30',
  info: 'text-info-contrast bg-info-main hover:[&:not([disabled])]:bg-info-dark focus-visible:outline-info-main/30 active:outline-info-main/30',
  success:
    'text-success-contrast bg-success-main hover:[&:not([disabled])]:bg-success-dark focus-visible:outline-success-main/30 active:outline-success-main/30',
  neutral:
    'text-neutral-contrast bg-neutral-light hover:[&:not([disabled])]:bg-neutral-main focus-visible:outline-neutral-main/40 active:outline-neutral-main/40',
  // WIP: only contained style for now
  white:
    'text-black bg-white hover:[&:not([disabled])]:bg-[#d6d6d6] focus-visible:outline-white/40 active:outline-white/40',
}

const OUTLINED_COLOR_CLASSES = {
  primary:
    'text-primary-dark !border-primary-main/50 hover:[&:not([disabled])]:bg-primary-main/[0.08] focus-visible:!bg-primary-main/[0.12] active:!bg-primary-main/[0.12]',
  secondary:
    'text-lime-900 !border-secondary-dark/50 hover:[&:not([disabled])]:bg-secondary-main/[0.16] focus-visible:bg-secondary-main/[0.24] active:!bg-secondary-main/[0.24]',
  tertiary:
    'text-tertiary-dark !border-tertiary-main/50 hover:[&:not([disabled])]:bg-tertiary-main/[0.08] focus-visible:!bg-tertiary-main/[0.12] active:!bg-tertiary-main/[0.12]',
  error:
    'text-error-dark !border-error-main/50 hover:[&:not([disabled])]:bg-error-main/[0.08] focus-visible:!bg-error-main/[0.12] active:!bg-error-main/[0.12]',
  warning:
    'text-orange-700 !border-warning-main/50 hover:[&:not([disabled])]:bg-warning-main/[0.08] focus-visible:!bg-warning-main/[0.12] active:!bg-warning-main/[0.12]',
  info: 'text-info-dark !border-info-main/50 hover:[&:not([disabled])]:bg-info-main/[0.08] focus-visible:!bg-info-main/[0.12] active:!bg-info-main/[0.12]',
  success:
    'text-success-dark !border-success-main/50 hover:[&:not([disabled])]:bg-success-main/[0.08] focus-visible:!bg-success-main/[0.12] active:!bg-success-main/[0.12]',
  neutral:
    'text-neutral-dark !border-neutral-main/60 hover:[&:not([disabled])]:bg-neutral-main/[0.16] focus-visible:!bg-neutral-main/[0.24] active:!bg-neutral-main/[0.24]',
}

const TEXT_COLOR_CLASSES = {
  primary:
    'text-primary-dark hover:[&:not([disabled])]:bg-primary-main/[0.08] focus-visible:!bg-primary-main/[0.12] active:!bg-primary-main/[0.12]',
  secondary:
    'text-lime-900 hover:[&:not([disabled])]:bg-secondary-main/[0.16] focus-visible:!bg-secondary-main/[0.24] active:!bg-secondary-main/[0.24]',
  tertiary:
    'text-tertiary-dark hover:[&:not([disabled])]:bg-tertiary-main/[0.08] focus-visible:!bg-tertiary-main/[0.12] active:!bg-tertiary-main/[0.12]',
  error:
    'text-error-dark hover:[&:not([disabled])]:bg-error-main/[0.08] focus-visible:!bg-error-main/[0.12] active:!bg-error-main/[0.12]',
  warning:
    'text-orange-700 hover:[&:not([disabled])]:bg-warning-main/[0.08] focus-visible:!bg-warning-main/[0.12] active:!bg-warning-main/[0.12]',
  info: 'text-info-dark hover:[&:not([disabled])]:bg-info-main/[0.08] focus-visible:!bg-info-main/[0.12] active:!bg-info-main/[0.12]',
  success:
    'text-success-dark hover:[&:not([disabled])]:bg-success-main/[0.08] focus-visible:!bg-success-main/[0.12] active:!bg-success-main/[0.12]',
  neutral:
    'text-neutral-dark hover:[&:not([disabled])]:bg-neutral-main/[0.16] focus-visible:!bg-neutral-main/[0.24] active:!bg-neutral-main/[0.24]',
}

export const VARIANT_CLASSES = {
  contained: COLOR_CLASSES,
  outlined: OUTLINED_COLOR_CLASSES,
  text: TEXT_COLOR_CLASSES,
}

export const SIZE_CLASSES = {
  small: 'text-xs py-2 px-3',
  medium: 'text-sm py-[10px] px-4',
  large: 'text-base font-semibold py-3 px-6 leading-6',
}

interface ButtonProps {
  href?: string
  target?: string
  nativeLink?: boolean
  size?: keyof typeof SIZE_CLASSES
  variant?: keyof typeof VARIANT_CLASSES
  color?: keyof typeof COLOR_CLASSES
  theme?: {
    accent?: string
    accentText?: string
  }
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
      theme,
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

    const variantClasses =
      VARIANT_CLASSES[variant as keyof typeof VARIANT_CLASSES] ||
      VARIANT_CLASSES.contained
    const colorClasses =
      variantClasses[color as keyof typeof variantClasses] ||
      variantClasses.primary
    const sizeClasses =
      SIZE_CLASSES[size as keyof typeof SIZE_CLASSES] || SIZE_CLASSES.medium

    // Use theme colors if provided, otherwise use default color classes
    const finalColorClasses = theme?.accent && theme?.accentText 
      ? `${theme.accent} ${theme.accentText} hover:opacity-80` 
      : colorClasses

    const compiledClassName = `${baseClasses} ${sizeClasses} ${finalColorClasses} ${
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
