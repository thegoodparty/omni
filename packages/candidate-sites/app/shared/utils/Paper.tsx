import { ReactNode } from 'react'

interface PaperProps {
  children: ReactNode
  className?: string
  theme?: {
    bg?: string
    text?: string
    border?: string
  }
  [key: string]: any
}

export default function Paper({ children, className, theme, ...rest }: PaperProps) {
  const bgClass = theme?.bg || 'bg-white'
  const textClass = theme?.text || 'text-gray-800'
  const borderClass = theme?.border || 'border-black/[0.12]'
  
  return (
    <div
      className={`${bgClass} ${textClass} border ${borderClass} p-4 md:p-6 rounded-xl ${
        className || ''
      }`}
      {...rest}
    >
      {children}
    </div>
  )
}
