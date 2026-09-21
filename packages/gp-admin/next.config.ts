import type { NextConfig } from 'next'
import path from 'node:path'

const nextConfig: NextConfig = {
  // ESLint already runs in the Validate CI job; don't re-run it during builds.
  eslint: { ignoreDuringBuilds: true },
  // The outreach-results page posts a fulfilment results CSV through a server
  // action as raw text, because a poll's file has to reach S3 byte for byte.
  // Next defaults this to 1MB and a results file for a 10,000-recipient send
  // is plausibly 2-3MB, so the default would reject real work at the action
  // boundary with a generic body-limit error. Next has no per-action setting,
  // so this raises it for the whole app; gp-admin is staff-only behind Clerk.
  // Keep in step with MAX_RESULTS_FILE_BYTES in
  // src/app/dashboard/outreach-results/types.ts, which is the check that
  // produces a readable message before a file ever gets this far.
  experimental: {
    serverActions: { bodySizeLimit: '5mb' },
  },
  outputFileTracingRoot: path.join(__dirname, '../..'),
  reactStrictMode: true,
  // This empty config is intentional to allow for the use of turbopack as the default bundler
  //  while still allowing for the use of webpack for development of linked packages.
  turbopack: {
    root: __dirname,
  },
  transpilePackages: ['@goodparty_org/sdk'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's3.us-west-2.amazonaws.com',
      },
    ],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.snapshot = {
        ...config.snapshot,
        managedPaths: (config.snapshot?.managedPaths ?? []).filter(
          (p: string | RegExp) => !String(p).includes('node_modules')
        ),
      }
      config.resolve.symlinks = true
      config.watchOptions = {
        ...config.watchOptions,
        followSymlinks: true,
      }
    }
    return config
  },
}

export default nextConfig
