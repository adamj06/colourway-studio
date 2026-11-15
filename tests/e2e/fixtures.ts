import { expect, test as base } from '@playwright/test';
import { isTrustedBypassTarget } from './trusted-origin';

/**
 * Lets the smoke run through Vercel Deployment Protection on previews.
 *
 * The secret is sent once, by the Node-side request context, to the deployment's own URL with redirects off.
 * Vercel answers with a host-only bypass cookie that the browser context shares, so the page itself never
 * sends the secret header to anyone: not to the deployment on later requests, not on any redirect, and not
 * to third parties such as framemark.vam.ac.uk. (A per-request route override would also follow redirects.)
 */
export const test = base.extend<{ bypassSecret: string | undefined }>({
  bypassSecret: [process.env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined, { option: true }],

  context: async ({ context, baseURL, bypassSecret }, applyFixture) => {
    if (bypassSecret) {
      if (!baseURL || !isTrustedBypassTarget(baseURL, process.env.BYPASS_ALLOWED_HOSTS)) {
        throw new Error(
          'Refusing to send the Vercel bypass secret: BASE_URL is not https on *.vercel.app or in BYPASS_ALLOWED_HOSTS.',
        );
      }
      await context.request.get(baseURL, {
        headers: { 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' },
        maxRedirects: 0,
        failOnStatusCode: false,
      });
    }
    await applyFixture(context);
  },
});

export { expect };
