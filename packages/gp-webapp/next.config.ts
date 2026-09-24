import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import path from 'node:path'

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@goodparty_org/styleguide'],
  reactStrictMode: true,
  images: {
    remotePatterns: [
      'assets.goodparty.org',
      'assets-dev.goodparty.org',
      'images.ctfassets.net',
      'maps.googleapis.com',
      'assets.civicengine.com',
    ].map((hostname) => ({ protocol: 'https', hostname })),
  },
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Document-Policy',
            value: 'js-profiling',
          },
        ],
      },
    ]
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE
    if (!apiBase) {
      // Fail loudly at config load instead of silently proxying the public
      // PDF share endpoint to a same-host 404. Every other rewrite below is
      // independent of `apiBase`, so we list them either way and only gate
      // the API proxies on its presence.
      // eslint-disable-next-line no-console
      console.error(
        'next.config: NEXT_PUBLIC_API_BASE is not set — /api/v1/briefings/:uuid will not be proxied to gp-api.',
      )
    }
    return [
      {
        source: '/sitemap.xml',
        destination: '/sitemaps/sitemap-index.xml',
      },
      {
        source: '/news-feed.xml',
        destination: '/api/news-feed',
      },
      {
        source: '/robots.txt',
        destination: '/api/robots',
      },
      // First-party proxy for Segment. Privacy browsers (Brave) and ad
      // blockers block `cdn.segment.com` and `api.segment.io` by hostname.
      // The settings fetch is the fatal one: when it fails,
      // `AnalyticsBrowser.load()` rejects and every `trackEvent` call becomes
      // a silent no-op, so we lose all events from those users rather than
      // some. Serving both from our own origin makes them unblockable without
      // also breaking the app. Same trick as Sentry's `tunnelRoute` below.
      //
      // `/mx` is intentionally opaque: EasyPrivacy carries generic path rules
      // for `/analytics`, `/segment` and `/track`, which would block a
      // descriptively named prefix on any origin. It is also excluded from the
      // middleware matcher so these requests never reach Clerk.
      //
      // Only the CDN half lives here. These are static asset fetches with no
      // per-client semantics, so a rewrite is free and correct. The ingestion
      // half (`/mx/evs/*`) is a route handler instead — see
      // `app/mx/evs/[...path]/route.ts` for why it has to forward the client
      // IP itself.
      //
      // Paths mirror what @segment/analytics-next builds from `cdnURL`:
      // `/v1/projects/<writeKey>/settings` and `/next-integrations/*`.
      {
        source: '/mx/v1/projects/:path*',
        destination: 'https://cdn.segment.com/v1/projects/:path*',
      },
      {
        source: '/mx/next-integrations/:path*',
        destination: 'https://cdn.segment.com/next-integrations/:path*',
      },
      // Public PDF share link for meeting briefings. Proxies to gp-api so the
      // shareable URL lives on this app's own origin (e.g.
      // `app.goodparty.org/api/v1/briefings/{uuid}`) instead of leaking the
      // API subdomain into mailto:/sms: payloads. Note the marketing origin
      // (`goodparty.org`) is a different deployment that never serves this
      // rewrite, so the share URL must never be built from it. Skipped when
      // `apiBase` is unset so we don't register a rewrite to
      // `/v1/briefings/:uuid` that would 404 invisibly.
      ...(apiBase
        ? [
            {
              source: '/api/v1/briefings/:uuid',
              destination: `${apiBase}/v1/briefings/:uuid`,
            },
            // Chief of Staff dashboard + reusable chat surface proxy their
            // browser calls through /api to gp-api (cards, support estimate,
            // and the /v1/chats SSE endpoints).
            {
              source: '/api/v1/dashboard/:path*',
              destination: `${apiBase}/v1/dashboard/:path*`,
            },
            {
              source: '/api/v1/chats',
              destination: `${apiBase}/v1/chats`,
            },
            {
              source: '/api/v1/chats/:path*',
              destination: `${apiBase}/v1/chats/:path*`,
            },
          ]
        : []),
    ]
  },
  productionBrowserSourceMaps: true,
}

export default withSentryConfig(nextConfig, {
  org: 'goodparty',
  project: 'gp-webapp',
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
})
