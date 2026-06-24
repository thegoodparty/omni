import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'GoodParty Prototypes' }

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body>{children}</body>
  </html>
)

export default RootLayout
