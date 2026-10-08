import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@goodparty_org/styleguide'],
  // The build script type-checks with tsc (TypeScript 7) before next build, so
  // skip next build's slower in-process check on the TypeScript 6 API.
  typescript: { ignoreBuildErrors: true },
  // The gallery index reads app/p at request time (dynamic = 'force-dynamic').
  // Trace those source files into the serverless bundle so the readdir resolves.
  outputFileTracingIncludes: {
    '/': ['./app/p/**/*'],
  },
}

export default nextConfig
