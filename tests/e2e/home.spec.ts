import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test.describe('home page', () => {
  test('home page has no serious or critical accessibility violations @smoke', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad, `Serious/critical a11y violations: ${bad.map((v) => v.id).join(', ')}`).toHaveLength(0);
  });

  test('home page document is served with security headers and no x-powered-by @smoke', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    const headers = response!.headers();

    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("img-src 'self' blob: data: https://framemark.vam.ac.uk");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self'");
    // A build that ran with the wrong NODE_ENV would ship the development CSP, which allows eval.
    expect(csp).not.toContain('unsafe-eval');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();

    if (!process.env.BASE_URL) {
      expect(headers['strict-transport-security']).toBeUndefined();
      expect(csp).not.toContain('upgrade-insecure-requests');
    }
    // smoke.yml passes the Vercel environment of the deployment under test. Assert on includeSubDomains and the CSP
    // directive rather than mere presence, because Vercel can add its own HSTS header on *.vercel.app.
    if (process.env.DEPLOY_ENV?.toLowerCase() === 'production') {
      expect(headers['strict-transport-security']).toContain('includeSubDomains');
      expect(csp).toContain('upgrade-insecure-requests');
    }
  });
});
