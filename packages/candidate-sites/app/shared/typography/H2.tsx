import { ReactNode } from 'react'

interface H2Props {
  children: ReactNode
  className?: string
  [key: string]: any
}

export default function H2({ children, className = '', ...restProps }: H2Props) {
  return (
    <h2 className={`font-semibold text-2xl ${className}`} {...restProps}>
      {children}
    </h2>
  )
} 