'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { JSX, ReactNode } from 'react'
import { SidebarProvider } from './Sidebar'
import { Theme } from '@radix-ui/themes'

/**
 * ClerkProvider doesn't render DOM elements, safe to wrap <html>
 */
export function ClerkProviderWrapper({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  return <ClerkProvider>{children}</ClerkProvider>
}

/**
 * Theme renders a <div class="radix-themes">, must be inside <body>
 */
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
