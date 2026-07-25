import type { ReactNode } from 'react'
import { Open_Sans, Outfit } from 'next/font/google'
import './globals.css'

// Match gp-webapp's typography: Open Sans for body, Outfit for display/headers.
// Exposed as the same CSS variables the styleguide tokens reference.
const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--open-sans-font',
  adjustFontFallback: false,
})

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--outfit-font',
})

export const metadata = { title: 'GoodParty Prototypes' }

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en" className={`${openSans.variable} ${outfit.variable}`}>
    {/* font-opensans = DS token utility (--font-opensans) so every prototype
        renders in the design-system body font, matching Storybook / gp-webapp. */}
    <body className="font-opensans">{children}</body>
  </html>
)

export default RootLayout
