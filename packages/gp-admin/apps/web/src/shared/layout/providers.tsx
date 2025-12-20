'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { JSX, ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return <ClerkProvider>{children}</ClerkProvider>
}
