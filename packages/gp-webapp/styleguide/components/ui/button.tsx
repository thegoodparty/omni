import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'

import { cn } from '@styleguide/lib/utils'

const LoadingSpinner = ({ className }: { className?: string }) => (
  <LoaderCircle className={cn('animate-spin', className)} />
)

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive border",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground border-primary hover:bg-primary/90',
        secondary:
          'bg-secondary text-secondary-foreground border-secondary hover:bg-secondary/80',
        destructive:
          'bg-destructive text-destructive-foreground border-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'bg-transparent border-tertiary-dark text-tertiary-dark hover:bg-tertiary-dark/5 focus-visible:ring-[3px]',
        ghost:
          'bg-transparent border-transparent text-tertiary-dark hover:bg-tertiary-dark/5 focus-visible:ring-[3px]',
        link: 'bg-transparent text-link border-transparent underline underline-offset-4 hover:text-link/80',
        neutral:
          'bg-tertiary-light text-tertiary-dark border-transparent hover:bg-tertiary-light/80',
        alertOutline:
          'bg-transparent [border-color:var(--alert-accent)] [color:var(--alert-accent)] hover:[background-color:color-mix(in_srgb,var(--alert-accent)_10%,transparent)]',
        alertFilled:
          '[background-color:var(--alert-accent)] [border-color:var(--alert-accent)] [color:var(--alert-accent-fg)] hover:opacity-90',
      },
      size: {
        small: 'h-8 px-4 py-2 text-sm tracking-wide has-[>svg]:px-3',
        medium: 'h-10 px-5 py-2.5 text-base tracking-wide has-[>svg]:px-4',
        large: 'h-12 px-6 py-3 text-base tracking-wide has-[>svg]:px-5',
      },
      iconPosition: {
        left: '',
        right: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'medium',
      iconPosition: 'left',
    },
  },
)

interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  loadingText?: string
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      icon,
      iconPosition = 'left',
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    const isDisabled = disabled || loading

    if (asChild) {
      return (
        <Comp
          ref={ref}
          data-slot="button"
          data-loading={loading}
          className={cn(
            buttonVariants({
              variant,
              size,
              iconPosition,
              className,
            }),
          )}
          {...props}
          disabled={isDisabled}
        >
          {children}
        </Comp>
      )
    }

    const content = loading ? (
      <>
        <LoadingSpinner className="size-4" />
        {loadingText || children}
      </>
    ) : (
      <>
        {icon && iconPosition === 'left' && icon}
        {children}
        {icon && iconPosition === 'right' && icon}
      </>
    )

    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-loading={loading}
        className={cn(
          buttonVariants({ variant, size, iconPosition, className }),
        )}
        {...props}
        disabled={isDisabled}
      >
        {content}
      </Comp>
    )
  },
)

Button.displayName = 'Button'

export { Button, buttonVariants, type ButtonProps }
