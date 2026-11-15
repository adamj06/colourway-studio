import { defineConfig, devices } from '@playwright/test';

// An empty BASE_URL (for example a deployment event with no environment_url) must not fall through to the
// local server and silently test the wrong thing: treat it as unset here, and smoke.yml fails loudly instead.
const remoteBaseUrl = process.env.BASE_URL || undefined;
const baseURL = remoteBaseUrl ?? 'http://localhost:3000';
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  // @external tests talk to the real framemark.vam.ac.uk, so they stay out of the PR e2e job (flaky-by-nature, and
  // CI must not depend on a third party). contract.yml and smoke.yml set RUN_EXTERNAL=1 to include them.
  ...(process.env.RUN_EXTERNAL ? {} : { grepInvert: /@external/ }),
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    // Traces record request headers, so never record them when the bypass secret is in play.
    // (The bypass header itself is added per-origin in tests/e2e/fixtures.ts.)
    trace: bypassSecret ? 'off' : 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Locally (no BASE_URL) test a production build, like what ships. With BASE_URL we test a live deployment.
  ...(remoteBaseUrl
    ? {}
    : {
        webServer: {
          command: 'npm run build && npm run start',
          url: baseURL,
          reuseExistingServer: !isCI,
          timeout: 300_000,
        },
      }),
});
