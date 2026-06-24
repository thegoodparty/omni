import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@goodparty_org/styleguide'],
  // The gallery index reads app/p at request time (dynamic = 'force-dynamic').
  // Trace those source files into the serverless bundle so the readdir resolves.
  outputFileTracingIncludes: {
    '/': ['./app/p/**/*'],
  },
}

export default nextConfig
