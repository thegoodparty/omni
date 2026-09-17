import { Open_Sans, Outfit } from 'next/font/google'
import Script from 'next/script'
import { Suspense } from 'react'
import PageWrapper from './shared/layouts/PageWrapper'
import './globals.css'
import VwoScript from '@shared/scripts/VwoScript'
import { APP_BASE, IS_PROD } from 'appEnv'
import RouteTracker from '@shared/scripts/RouteTrackerScript'
import AnalyticsSessionReplayMiddleware from '@shared/AnalyticsSessionReplayMiddleware'
import { SerwistProvider } from '@serwist/next/react'
import { SUPPORT_CHAT_SCRIPT_ID } from '@shared/utils/supportContact'

const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--open-sans-font',
  adjustFontFallback: false,
})

// Display font for the marketing design system (e.g. the sign-up page
// headings and stat cards). Exposed as a CSS variable and applied only where
// referenced. Weights: 500 (demographic labels), 600 (card titles/figures),
// 700 (hero headings).
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--outfit-font',
})

// Production, dev and PR previews all load the support chat; locally it is
// opt-in. VERCEL_ENV is Vercel's reserved runtime var, always present
// server-side, and covers all three in one expression: per docs/deployment.md
// the dev deploy and PR previews both hit Vercel's preview target and prod
// hits the production target. Deliberately NOT the NEXT_PUBLIC_VERCEL_TARGET_ENV
// that IS_PROD/IS_PREVIEW read — this app does not reliably get it (see
// app/shared/experiments/flagOverrides.ts), and keying the chat off IS_PREVIEW
// meant previews never loaded it at all.
//
// Read only here. It stays out of appEnv because VERCEL_ENV is not exposed to
// the browser, so an exported constant would be quietly false in client code.
// Client code asks the DOM instead, via SUPPORT_CHAT_SCRIPT_ID.
const supportChatEnabled =
  process.env.VERCEL_ENV === 'production' ||
  process.env.VERCEL_ENV === 'preview' ||
  process.env.NEXT_PUBLIC_SUPPORT_CHAT === '1'

export const metadata = {
  applicationName: 'GoodParty',
  metadataBase: new URL(APP_BASE),
  title: 'GoodParty.org | Empowering independents to run, win and serve.',
  description:
    "We're transforming civic leadership with tools and data that empower independents to run, win and serve without needing partisan or big-money support. Join Us!",
}

const RootLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <html lang="en" className={`${openSans.variable} ${outfit.variable}`}>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta property="og:site_name" content="GoodParty.org" />
      <meta property="og:type" content="website" />

      <meta property="twitter:card" content="summary_large_image" />
      <meta name="theme-color" content="#ffffff" />
      <meta property="fb:app_id" content="241239336921963" />
      {!IS_PROD && <meta name="robots" content="noindex" />}
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

      <link rel="manifest" href="/manifest.json" />

      <VwoScript />

      <Script strategy="afterInteractive" id="gtm">
        {`
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-M53W2ZV');
      `}
      </Script>

      {supportChatEnabled && (
        <>
          {/* The support chat is opened from "Get help" in the dashboard nav,
              not from a launcher hovering over every page. This suppresses the
              launcher and must run before the loader below. Opened via
              @shared/utils/supportWidget. */}
          <Script id={SUPPORT_CHAT_SCRIPT_ID} strategy="beforeInteractive">
            {'window.hsConversationsSettings = { loadImmediately: false };'}
          </Script>
          <Script
            type="text/javascript"
            id="hs-script-loader"
            strategy="afterInteractive"
            src="//js.hs-scripts.com/21589597.js"
          />
        </>
      )}
    </head>
    <body>
      {/* Registers the Serwist service worker (public/sw.js, built by the
          `serwist build` step). Disabled under `next dev`, where no SW is
          generated — mirrors next-pwa's old dev-disable behavior. */}
      <SerwistProvider
        swUrl="/sw.js"
        disable={process.env.NODE_ENV !== 'production'}
      />
      <Suspense>
        <RouteTracker />
      </Suspense>
      <AnalyticsSessionReplayMiddleware />
      <PageWrapper>{children}</PageWrapper>
      <noscript>
        <iframe
          src="https://www.googletagmanager.com/ns.html?id=GTM-M53W2ZV"
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
        />
      </noscript>
    </body>
  </html>
)
export default RootLayout
