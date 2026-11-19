import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/config/security-headers';
import { env } from './src/env';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // /how-built reads these at build time, but with Cache Components Vercel can still call the function (for example
  // for link-preview bots), and the file tracer cannot follow the loader's computed paths. Ship them with it (ADR 0006).
  outputFileTracingIncludes: {
    '/how-built': ['./data/build-log.json', './docs/adr/*.md', './docs/friction-log.md', './docs/cost/ledger.csv'],
  },
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
