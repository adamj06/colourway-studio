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

    expect(headers['content-security-policy']).toContain("img-src 'self' blob: data: https://framemark.vam.ac.uk");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();

    if (!process.env.BASE_URL) {
      expect(headers['strict-transport-security']).toBeUndefined();
      expect(headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    }
  });
});
