import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'

import { cn } from '@styleguide/lib/utils'

const LoadingSpinner = ({ className }: { className?: string }) => (
  <LoaderCircle className={cn('animate-spin', className)} />
)

const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-full transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive border',
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
      },
      size: {
        small: 'size-8',
        medium: 'size-10',
        large: 'size-12',
        xLarge: 'size-16',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'medium',
    },
  },
)

interface IconButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  asChild?: boolean
  loading?: boolean
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    const isDisabled = disabled || loading

    const spinnerSize =
      size === 'small'
        ? 'size-4'
        : size === 'large'
          ? 'size-6'
          : size === 'xLarge'
            ? 'size-8'
            : 'size-5'

    return (
      <Comp
        ref={ref}
        data-slot="icon-button"
        data-loading={loading}
        className={cn(iconButtonVariants({ variant, size, className }))}
        {...props}
        disabled={isDisabled}
      >
        {loading ? <LoadingSpinner className={spinnerSize} /> : children}
      </Comp>
    )
  },
)

IconButton.displayName = 'IconButton'

export { IconButton, iconButtonVariants, type IconButtonProps }
