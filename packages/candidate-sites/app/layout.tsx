import type { Metadata } from "next";
import { Outfit } from 'next/font/google'
import "./globals.css";

const outfit = Outfit({ subsets: ['latin'], variable: '--outfit-font' })

export const metadata: Metadata = {
  title: "GoodParty.org Candidate Sites",
  description: "GoodParty.org Candidate Sites",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
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
      <body
        className={`${outfit.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
