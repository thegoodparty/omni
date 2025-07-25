import { ReactNode } from 'react'

interface PaperProps {
  children: ReactNode
  className?: string
  [key: string]: any
}

export default function Paper({ children, className, ...rest }: PaperProps) {
  return (
    <div
      className={`bg-white border border-black/[0.12] p-4 md:p-6 rounded-xl ${
        className || ''
      }`}
      {...rest}
    >
      {children}
    </div>
  )
}
