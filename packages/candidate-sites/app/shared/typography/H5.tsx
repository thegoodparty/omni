import { ReactNode } from 'react'

interface H5Props {
  children: ReactNode
  className?: string
  [key: string]: any
}

export default function H5({ children, className = '', ...restProps }: H5Props) {
  return (
    <h5 className={`font-medium text-lg ${className}`} {...restProps}>
      {children}
    </h5>
  )
} 