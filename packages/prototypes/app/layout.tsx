import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import './globals.css'

// Match gp-webapp's typography: Open Sans for body, Outfit for display/headers.
// Exposed as the same CSS variables the styleguide tokens reference, and
// self-hosted for the same reason gp-webapp's are — see
// packages/gp-webapp/app/fonts/index.ts.
const openSans = localFont({
  src: './fonts/open-sans-latin-wght-normal.woff2',
  weight: '300 800',
  style: 'normal',
  display: 'swap',
  variable: '--open-sans-font',
  adjustFontFallback: false,
})

const outfit = localFont({
  src: './fonts/outfit-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--outfit-font',
})

export const metadata = { title: 'GoodParty Prototypes' }

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en" className={`${openSans.variable} ${outfit.variable}`}>
    <body>{children}</body>
  </html>
)

export default RootLayout
