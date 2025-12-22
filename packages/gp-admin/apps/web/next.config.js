/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['goodparty-styleguide'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'assets.goodparty.org',
      },
    ],
  },
}

module.exports = nextConfig
