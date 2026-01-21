'use client'

import { JSX, ReactNode } from 'react'
import { SidebarProvider } from './Sidebar'
import { Theme } from '@radix-ui/themes'

export function ThemeProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  return (
    <Theme accentColor="indigo" grayColor="slate" radius="large">
      <SidebarProvider>{children}</SidebarProvider>
    </Theme>
  )
}
