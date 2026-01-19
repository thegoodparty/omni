import type { Metadata } from 'next'
import './globals.css'
import { ClerkProviderWrapper, ThemeProvider } from '@/shared/layout/providers'
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
    <ClerkProviderWrapper>
      <html lang="en">
        <body>
          <ThemeProvider>
            <Header />
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProviderWrapper>
  )
}
