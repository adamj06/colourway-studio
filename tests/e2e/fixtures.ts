import { expect, test as base } from '@playwright/test';

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

/**
 * Lets the smoke run through Vercel Deployment Protection on previews. The bypass header is added ONLY to
 * requests to the deployment's own origin: Playwright's `extraHTTPHeaders` would also send the secret to every
 * third party the page loads (for example framemark.vam.ac.uk images).
 */
export const test = base.extend({
  context: async ({ context, baseURL }, applyFixture) => {
    if (bypassSecret && baseURL) {
      const origin = new URL(baseURL).origin;
      await context.route(`${origin}/**`, (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            'x-vercel-protection-bypass': bypassSecret,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }),
      );
    }
    await applyFixture(context);
  },
});

export { expect };
