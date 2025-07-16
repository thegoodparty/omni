'use client'

import CircularProgress from '@mui/material/CircularProgress'

const SIZES = {
  small: 14,
  medium: 16,
  large: 20,
}

interface ButtonLoadingProps {
  size?: keyof typeof SIZES
  className?: string
}

export default function ButtonLoading({ size = 'medium', className = '' }: ButtonLoadingProps) {
  return (
    <CircularProgress
      size={SIZES[size] || SIZES.medium}
      className={`mr-2 ${className}`}
      color="inherit"
    />
  )
} 