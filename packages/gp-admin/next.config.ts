import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
