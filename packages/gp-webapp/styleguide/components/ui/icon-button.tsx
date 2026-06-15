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
          'bg-transparent text-foreground border-border hover:bg-muted focus-visible:ring-[3px]',
        ghost:
          'bg-transparent text-foreground border-transparent hover:bg-muted focus-visible:ring-[3px]',
        link: 'bg-transparent text-link border-transparent underline underline-offset-4 hover:text-link/80',
        whiteOutline:
          'bg-transparent text-white border-white hover:bg-white/10 focus-visible:border-white focus-visible:ring-white/20 focus-visible:ring-[3px]',
        whiteGhost:
          'bg-transparent text-white border-transparent hover:bg-white/10 focus-visible:border-white/20 focus-visible:ring-white/20 focus-visible:ring-[3px]',
      },
      size: {
        xSmall: 'size-6',
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

    // Calculate spinner size based on button size
    const getSpinnerSize = () => {
      switch (size) {
        case 'xSmall':
          return 'size-3'
        case 'small':
          return 'size-4'
        case 'medium':
          return 'size-5'
        case 'large':
          return 'size-6'
        case 'xLarge':
          return 'size-8'
        default:
          return 'size-5'
      }
    }

    return (
      <Comp
        ref={ref}
        data-slot="icon-button"
        data-loading={loading}
        className={cn(iconButtonVariants({ variant, size, className }))}
        {...props}
        disabled={isDisabled}
      >
        {loading ? <LoadingSpinner className={getSpinnerSize()} /> : children}
      </Comp>
    )
  },
)

IconButton.displayName = 'IconButton'

export { IconButton, iconButtonVariants, type IconButtonProps }
