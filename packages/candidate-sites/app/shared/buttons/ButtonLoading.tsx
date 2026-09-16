'use client'

const SIZE_CLASSES = {
  small: 'h-3.5 w-3.5 border',
  medium: 'h-4 w-4 border',
  large: 'h-5 w-5 border-2',
}

interface ButtonLoadingProps {
  size?: keyof typeof SIZE_CLASSES
  className?: string
}

// Replaces MUI's <CircularProgress> — an inline CSS spinner. `border-current`
// picks up the button's own text color (same behavior as MUI's color="inherit").
export default function ButtonLoading({
  size = 'medium',
  className = '',
}: ButtonLoadingProps) {
  return (
    <span
      role="progressbar"
      aria-label="Loading"
      className={`mr-2 inline-block animate-spin rounded-full border-current border-t-transparent ${SIZE_CLASSES[size] || SIZE_CLASSES.medium} ${className}`}
    />
  )
}
