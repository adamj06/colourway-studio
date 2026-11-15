import { defineConfig, devices } from '@playwright/test';

const remoteBaseUrl = process.env.BASE_URL;
const baseURL = remoteBaseUrl ?? 'http://localhost:3000';
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Lets the smoke run through Vercel Deployment Protection on previews, when the secret is configured.
    ...(bypassSecret
      ? { extraHTTPHeaders: { 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' } }
      : {}),
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
