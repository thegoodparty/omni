'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { JSX, ReactNode } from 'react'
import { SidebarProvider } from './Sidebar'

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ClerkProvider>
      <SidebarProvider>{children}</SidebarProvider>
    </ClerkProvider>
  )
}
