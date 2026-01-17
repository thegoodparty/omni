'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { JSX, ReactNode } from 'react'
import { SidebarProvider } from './Sidebar'
import { Theme } from '@radix-ui/themes'

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ClerkProvider>
      <Theme accentColor="indigo" grayColor="slate" radius="large">      
        <SidebarProvider>{children}</SidebarProvider>
      </Theme>
    </ClerkProvider>
  )
}
