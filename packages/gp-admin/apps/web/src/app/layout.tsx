import type { Metadata } from 'next'
import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { SidebarProvider } from '@/shared/layout/SidebarContext'
import { Theme } from '@radix-ui/themes'
import { Header } from '@/shared/layout/Header'

export const metadata: Metadata = {
  title: 'GP Admin',
  description: 'GP Admin Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <Theme accentColor="indigo" grayColor="slate" radius="large">
            <SidebarProvider>
              <Header />
              {children}
            </SidebarProvider>
          </Theme>
        </body>
      </html>
    </ClerkProvider>
  )
}
