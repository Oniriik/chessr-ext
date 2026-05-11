import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    // Skip type checking during build (we check in CI)
    ignoreBuildErrors: true,
  },
  eslint: {
    // Skip linting during build (we lint in CI)
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
