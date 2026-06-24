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
      'assets-qa.goodparty.org',
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
      // the briefings proxy on its presence.
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
      // Public PDF share link for meeting briefings. Proxies to gp-api so the
      // shareable URL lives on the marketing domain (e.g.
      // `goodparty.org/api/v1/briefings/{uuid}`) instead of leaking the API
      // subdomain into mailto:/sms: payloads. Skipped when `apiBase` is
      // unset so we don't register a rewrite to `/v1/briefings/:uuid` on the
      // marketing host (which would 404 invisibly).
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
