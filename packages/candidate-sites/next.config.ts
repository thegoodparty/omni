import type { NextConfig } from 'next'
import path from 'node:path'

const nextConfig: NextConfig = {
  // ESLint already runs in the Validate CI job; don't re-run it during builds.
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: path.join(__dirname, '../..'),
  images: {
    domains: [
      'assets.goodparty.org',
      'assets-dev.goodparty.org',
      'assets-qa.goodparty.org',
      'images.ctfassets.net',
      'maps.googleapis.com',
      'assets.civicengine.com',
    ],
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
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow, noarchive, nosnippet, noimageindex',
          },
        ],
      },
    ]
  },
}

export default nextConfig
