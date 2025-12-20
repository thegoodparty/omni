import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/shared/layout/providers'
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
    <Providers>
      <html lang="en">
        <body>
          <Header />
          {children}
        </body>
      </html>
    </Providers>
  )
}
