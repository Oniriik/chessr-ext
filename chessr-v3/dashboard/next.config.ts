import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Produce a minimal self-contained server bundle for Docker deployments.
  output: 'standalone',
};

export default nextConfig;
