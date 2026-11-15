import { expect, test } from './fixtures';
import { indianDesign, mockVam } from './mock-vam';

// @external: the design page's image comes from the REAL framemark.vam.ac.uk (only the V&A JSON API is mocked).
// Proves end to end that a real IIIF image can be read for palette extraction: the canvas is not tainted, the worker
// runs, and swatches come back. Runs in the contract and smoke workflows (RUN_EXTERNAL=1), never in the PR e2e job.
test('@external a real framemark image yields a palette without error', async ({ page }) => {
  await mockVam(page, { realImages: true });
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));

  await page.goto(`/design/${indianDesign.systemNumber}`);

  await expect(page.getByRole('status').filter({ hasText: /^Palette ready: \d colours?$/ })).toBeVisible({
    timeout: 30_000,
  });
  expect(await page.getByRole('button', { name: /^Colour \d+ of \d+, #[0-9A-F]{6}, / }).count()).toBeGreaterThan(0);
  // (Next's own empty route announcer also has role=alert, so match our error text, not the role.)
  await expect(page.getByText(/couldn’t read the colours/)).toHaveCount(0);
  expect(problems).toEqual([]);
});
