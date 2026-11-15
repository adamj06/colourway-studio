import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders } from './security-headers';

type VercelEnv = 'production' | 'preview' | 'development' | undefined;
type NodeEnv = 'development' | 'production' | 'test';

const vercelEnvs: Array<[string, VercelEnv]> = [
  ['production', 'production'],
  ['preview', 'preview'],
  ['development', 'development'],
  ['undefined', undefined],
];
const nodeEnvs: NodeEnv[] = ['development', 'production', 'test'];

function headerMap(vercelEnv: VercelEnv, nodeEnv: NodeEnv = 'production') {
  const list = buildSecurityHeaders({ vercelEnv, nodeEnv });
  return new Map(list.map((h) => [h.key, h.value]));
}

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((d): [string, string] => {
      const t = d.trim();
      const i = t.indexOf(' ');
      return i === -1 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)];
    }),
  );
}

describe.each(vercelEnvs)('always-present headers (vercelEnv=%s)', (_name, vercelEnv) => {
  it.each(nodeEnvs)('sets the baseline headers when nodeEnv=%s', (nodeEnv) => {
    const h = headerMap(vercelEnv, nodeEnv);
    expect(h.has('Content-Security-Policy')).toBe(true);
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
    expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(h.get('X-Frame-Options')).toBe('DENY');
    expect(h.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    const pp = h.get('Permissions-Policy') ?? '';
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });

  it('has the required CSP directives', () => {
    const d = directives(headerMap(vercelEnv).get('Content-Security-Policy') ?? '');
    expect(d.get('default-src')).toBe("'self'");
    expect(d.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(d.get('img-src')).toBe("'self' blob: data: https://framemark.vam.ac.uk");
    expect(d.get('font-src')).toBe("'self'");
    expect(d.get('connect-src')).toBe("'self'");
    expect(d.get('object-src')).toBe("'none'");
    expect(d.get('worker-src')).toBe("'self'");
    expect(d.get('base-uri')).toBe("'self'");
    expect(d.get('form-action')).toBe("'self'");
    expect(d.get('frame-ancestors')).toBe("'none'");
    expect(d.get('script-src')).toContain("'self' 'unsafe-inline'");
  });

  it('allows no external host other than framemark in the CSP', () => {
    const csp = headerMap(vercelEnv).get('Content-Security-Policy') ?? '';
    const hosts = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(hosts).toEqual(['https://framemark.vam.ac.uk']);
  });

  it('has no duplicate keys and clean non-empty values', () => {
    const list = buildSecurityHeaders({ vercelEnv, nodeEnv: 'production' });
    const keys = list.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const h of list) {
      expect(h.value.length).toBeGreaterThan(0);
      expect(h.value).not.toMatch(/[\r\n]/);
    }
  });

  it('produces a well-formed CSP with no empty directives', () => {
    const csp = headerMap(vercelEnv).get('Content-Security-Policy') ?? '';
    expect(csp).not.toContain(';;');
    expect(csp.trim().endsWith(';')).toBe(false);
    for (const part of csp.split(';')) {
      expect(part.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('unsafe-eval', () => {
  it("is allowed in script-src when nodeEnv is 'development'", () => {
    const csp = headerMap(undefined, 'development').get('Content-Security-Policy') ?? '';
    expect(directives(csp).get('script-src')).toContain("'unsafe-eval'");
  });

  it.each(['production', 'test'] as const)("is never in the CSP when nodeEnv is '%s'", (nodeEnv) => {
    for (const [, v] of vercelEnvs) {
      const csp = headerMap(v, nodeEnv).get('Content-Security-Policy') ?? '';
      expect(csp).not.toContain('unsafe-eval');
    }
  });
});

describe.each(vercelEnvs)('production-only hardening (vercelEnv=%s)', (_name, vercelEnv) => {
  const isProd = vercelEnv === 'production';

  it.each(nodeEnvs)(
    `${isProd ? 'includes' : 'omits'} HSTS and upgrade-insecure-requests when nodeEnv=%s`,
    (nodeEnv) => {
      const h = headerMap(vercelEnv, nodeEnv);
      const csp = h.get('Content-Security-Policy') ?? '';
      const hasUpgrade = csp.split(';').some((p) => p.trim() === 'upgrade-insecure-requests');
      if (isProd) {
        expect(h.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
        expect(hasUpgrade).toBe(true);
      } else {
        expect(h.has('Strict-Transport-Security')).toBe(false);
        expect(hasUpgrade).toBe(false);
        expect(csp).not.toContain('upgrade-insecure-requests');
      }
    },
  );
});
