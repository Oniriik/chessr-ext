import type { NextConfig } from 'next';

const BULLBOARD_INTERNAL_URL =
  process.env.BULLBOARD_INTERNAL_URL || 'http://bullboard:3000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Produce a minimal self-contained server bundle for Docker deployments.
  output: 'standalone',

  // Proxy Bull Board through the dashboard so its UI lives under our
  // Supabase auth gate (see middleware.ts). The custom bullboard image
  // sets basePath=/queues/board, so paths line up 1:1.
  async rewrites() {
    return [
      { source: '/queues/board', destination: `${BULLBOARD_INTERNAL_URL}/queues/board` },
      { source: '/queues/board/:path*', destination: `${BULLBOARD_INTERNAL_URL}/queues/board/:path*` },
    ];
  },
};

export default nextConfig;
