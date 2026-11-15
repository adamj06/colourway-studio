export type SecurityHeaderInput = {
  vercelEnv: 'production' | 'preview' | 'development' | undefined;
  nodeEnv: 'development' | 'production' | 'test';
};

export type SecurityHeader = { key: string; value: string };

// TODO(ADR 0002): finalise img-src after the CORS spike decides how V&A images load.
const IMG_SRC = "img-src 'self' blob: data: https://framemark.vam.ac.uk";

function contentSecurityPolicy({ vercelEnv, nodeEnv }: SecurityHeaderInput): string {
  const scriptSrc =
    nodeEnv === 'development' ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    IMG_SRC,
    "font-src 'self'",
    "connect-src 'self'",
    // Explicit rather than falling back to script-src: only same-origin (bundled) workers, never blob: workers.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (vercelEnv === 'production') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/**
 * Security headers for every route. HSTS and upgrade-insecure-requests are sent only on the real
 * production deploy (VERCEL_ENV === 'production'), so local `next start` over http and previews keep working.
 */
export function buildSecurityHeaders(input: SecurityHeaderInput): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(input) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
  if (input.vercelEnv === 'production') {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
  }
  return headers;
}
