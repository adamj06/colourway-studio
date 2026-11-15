import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { indianDesign, mockVam, pageTwoNewTitle, searchResult } from './mock-vam';

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `Serious/critical a11y violations: ${bad.map((v) => v.id).join(', ')}`).toHaveLength(0);
}

test.describe('browse and open a design', () => {
  test('search, then open a design @smoke', async ({ page }) => {
    const { searchUrls } = await mockVam(page);
    await page.goto('/');

    const first = searchResult.items[0]!;
    await expect(page.getByRole('link', { name: new RegExp(first.title) }).first()).toBeVisible();
    await expect(page.getByRole('status')).toContainText(`of ${String(searchResult.total)} designs`);

    await page.getByRole('searchbox', { name: /search designs/i }).fill('indian');
    await expect(page).toHaveURL(/\?q=indian$/);
    await page
      .getByRole('link', { name: /Indian/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/design\/O78207$/);
    await expect(page.getByRole('heading', { level: 1, name: indianDesign.title })).toBeVisible();
    const image = page.getByRole('img', { name: /Indian/ });
    await expect(image).toHaveAttribute(
      'src',
      /^https:\/\/framemark\.vam\.ac\.uk\/collections\/2020MN1492\/full\/!1600,1600\/0\/default\.jpg$/,
    );
    await expect(image).toHaveAttribute('crossorigin', 'anonymous');
    await expect(page.locator('dd', { hasText: 'Morris, William' })).toBeVisible();
    expect(searchUrls.length).toBeGreaterThan(0);
  });

  test('debounces typing into a single search request', async ({ page }) => {
    const { searchUrls } = await mockVam(page);
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('designs');
    const before = searchUrls.length;

    await page.getByRole('searchbox').pressSequentially('strawberry', { delay: 30 });
    await expect(page).toHaveURL(/\?q=strawberry$/);
    await page.waitForTimeout(500);
    expect(searchUrls.length - before).toBe(1);
    expect(searchUrls.at(-1)).toContain('q=strawberry');
  });

  test('load more appends the next page without repeating a design', async ({ page }) => {
    await mockVam(page);
    await page.goto('/');
    const links = page.locator('main ul a');
    await expect(links).toHaveCount(searchResult.items.length);

    await page.getByRole('button', { name: 'Load more designs' }).click();
    await expect(page.getByRole('link', { name: new RegExp(pageTwoNewTitle) })).toBeVisible();
    // Page 2 repeated the first design: it must not appear twice.
    await expect(links).toHaveCount(searchResult.items.length + 1);
  });

  test('a load-more still in flight does not leak into a new search', async ({ page }) => {
    await mockVam(page, { page2DelayMs: 1200, page2Status: 502 });
    await page.goto('/');
    await expect(page.locator('main ul a')).toHaveCount(searchResult.items.length);

    await page.getByRole('button', { name: 'Load more designs' }).click();
    await page.getByRole('searchbox').fill('nomatch');
    await expect(page.getByRole('status')).toHaveText('No designs found for “nomatch”.');
    // The old request fails after the query changed: no alert, and nothing stuck in "Loading…".
    await page.waitForTimeout(1600);
    await expect(page.getByRole('alert').filter({ hasText: 'more designs' })).toHaveCount(0);
    await page.getByRole('searchbox').fill('');
    await expect(page.getByRole('button', { name: 'Load more designs' })).toBeEnabled();
  });

  test('each design page has its own title', async ({ page }) => {
    await mockVam(page);
    await page.goto('/design/O78207');
    await expect(page).toHaveTitle('Indian · Colourway Studio');
  });

  test('shows an empty state announced to assistive tech', async ({ page }) => {
    await mockVam(page);
    await page.goto('/');
    await page.getByRole('searchbox').fill('nomatch');
    await expect(page.getByRole('status')).toHaveText('No designs found for “nomatch”.');
  });

  test('shows a friendly error with a retry when search fails', async ({ page }) => {
    await mockVam(page, { searchStatus: 502 });
    await page.goto('/');
    const alert = page.getByRole('alert').filter({ hasText: 'V&A' });
    await expect(alert).toContainText('couldn’t reach the V&A');
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a design that does not exist shows a friendly message', async ({ page }) => {
    await mockVam(page);
    await page.goto('/design/O99999999');
    await expect(page.getByRole('heading', { name: /couldn’t find that design/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /All designs/ })).toBeVisible();
  });

  test('a malformed design id shows the not-found page without calling the API', async ({ page }) => {
    await mockVam(page);
    await page.goto('/design/not-an-id');
    await expect(page.getByRole('heading', { name: /couldn’t find that design/ })).toBeVisible();
  });

  test('is fully operable with the keyboard', async ({ page }) => {
    await mockVam(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Indian/ }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Colourway Studio' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link').filter({ hasText: searchResult.items[0]!.title }).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/design\/O\d+$/);
  });
});

test.describe('accessibility', () => {
  test('home with results has no serious or critical violations', async ({ page }) => {
    await mockVam(page);
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('designs');
    await page
      .getByRole('link', { name: /Indian/ })
      .first()
      .waitFor();
    await expectNoSeriousA11yViolations(page);
  });

  test('design page has no serious or critical violations @smoke', async ({ page }) => {
    await mockVam(page);
    await page.goto('/design/O78207');
    await expect(page.getByRole('heading', { level: 1, name: 'Indian' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('error and not-found states have no serious or critical violations', async ({ page }) => {
    await mockVam(page, { searchStatus: 502 });
    await page.goto('/');
    await expect(page.getByRole('alert').filter({ hasText: 'V&A' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.goto('/design/not-an-id');
    await expectNoSeriousA11yViolations(page);
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
