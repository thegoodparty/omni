import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/shared/layout/providers'
import { ClerkProvider } from '@clerk/nextjs'
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
          <ThemeProvider>
            <Header />
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
