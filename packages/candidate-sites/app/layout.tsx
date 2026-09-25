import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// Self-hosted for the same reason gp-webapp's are — see
// packages/gp-webapp/app/fonts/index.ts.
const outfit = localFont({
  src: './fonts/outfit-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--outfit-font',
})

export const metadata: Metadata = {
  title: 'GoodParty.org Candidate Sites',
  description: 'GoodParty.org Candidate Sites',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
    },
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          type="image/png"
          href="https://assets.goodparty.org/favicon/favicon-512x512.png"
          sizes="512x512"
        />
        <link
          rel="apple-touch-icon"
          href="https://assets.goodparty.org/favicon/android-icon-192x192.png"
        />
      </head>
      <body className={`${outfit.variable} antialiased`}>{children}</body>
    </html>
  )
}
