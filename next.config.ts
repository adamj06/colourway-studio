import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/config/security-headers';
import { env } from './src/env';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  headers() {
    const headers = buildSecurityHeaders({ vercelEnv: env.VERCEL_ENV, nodeEnv: env.NODE_ENV });
    return Promise.resolve([{ source: '/:path*', headers }]);
  },
};

export default nextConfig;
