import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test.describe('how this was built', () => {
  test('@smoke shows the build log, decisions, friction log and cost, each with content', async ({ page }) => {
    await page.goto('/how-built');
    await expect(page.getByRole('heading', { level: 1, name: 'How this was built' })).toBeVisible();

    for (const [name, item] of [
      ['Build log', 'li'],
      ['Decisions', 'li'],
      ['Friction log', 'li'],
      ['Cost', 'tbody tr'],
    ] as const) {
      const section = page.getByRole('region', { name });
      await expect(section.getByRole('heading', { level: 2, name })).toBeVisible();
      expect(await section.locator(item).count(), `${name} has items`).toBeGreaterThan(0);
    }
  });

  test('lists the first build-log entry with a PR link on a shipped feature', async ({ page }) => {
    await page.goto('/how-built');
    const log = page.getByRole('region', { name: 'Build log' });
    await expect(log.getByRole('heading', { level: 3, name: 'Guardrails before code' })).toBeVisible();
    const link = log.getByRole('link', { name: 'Pull request' }).first();
    await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\/.+\/pull\/\d+$/);
  });

  test('an ADR is collapsed until opened and then shows its rendered sections', async ({ page }) => {
    await page.goto('/how-built');
    const decisions = page.getByRole('region', { name: 'Decisions' });
    const adr = decisions.locator('details').filter({ hasText: 'ADR 0005' });
    await expect(adr).not.toHaveAttribute('open', '');
    await expect(adr.getByRole('heading', { level: 4, name: 'Context' })).toBeHidden();

    await adr.getByRole('heading', { level: 3 }).click();
    await expect(adr).toHaveAttribute('open', '');
    await expect(adr.getByRole('heading', { level: 4, name: 'Context' })).toBeVisible();
  });

  test('friction entries are newest first and the caught-by tally uses short, known categories', async ({ page }) => {
    await page.goto('/how-built');
    const friction = page.getByRole('region', { name: 'Friction log' });
    const titles = friction.locator('details h3');
    const total = await titles.count();
    expect(total).toBeGreaterThan(0);

    const stamps = await friction.locator('details summary span').allInnerTexts();
    expect(stamps).toHaveLength(total);
    expect(stamps).toEqual([...stamps].sort().reverse());

    // An entry can name two catchers, so the counts add up to at least the number of entries.
    const counts = await friction.locator('table tbody td:last-child').allInnerTexts();
    expect(counts.reduce((n, c) => n + Number(c), 0)).toBeGreaterThanOrEqual(total);
    const names = await friction.locator('table tbody th, table tbody td:first-child').allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    expect(
      names.every((name) => name.length <= 20),
      `category names: ${names.join(' | ')}`,
    ).toBe(true);
  });

  test('the cost section shows a grand total and a table per grouping', async ({ page }) => {
    await page.goto('/how-built');
    const cost = page.getByRole('region', { name: 'Cost' });
    await expect(cost.getByText(/^\$[\d,]+\.\d{2}/).first()).toBeVisible();
    await expect(cost.getByRole('table', { name: 'Estimated cost by branch' })).toBeVisible();
    await expect(cost.getByRole('table', { name: 'Estimated cost by model' })).toBeVisible();
  });

  test('is reachable from the site header', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'How this was built' }).click();
    await expect(page).toHaveURL(/\/how-built$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How this was built');
  });

  test('has a sensible heading outline and no serious or critical accessibility violations @smoke', async ({
    page,
  }) => {
    await page.goto('/how-built');
    // Open everything, so the hidden ADR and friction content is checked too.
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => {
        d.open = true;
      });
    });

    const levels = await page
      .locator('h1, h2, h3, h4, h5, h6')
      .evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    // A heading never skips a level going down the page.
    levels.slice(1).forEach((level, i) => {
      expect(level, `heading ${String(i + 1)} follows level ${String(levels[i])}`).toBeLessThanOrEqual(levels[i]! + 1);
    });

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad, `Serious/critical a11y violations: ${bad.map((v) => v.id).join(', ')}`).toHaveLength(0);
  });
});

test.describe('how this was built, without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('is prerendered: the content is in the HTML, not built by client code', async ({ page }) => {
    await page.goto('/how-built');
    await expect(page.getByRole('region', { name: 'Build log' }).locator('li').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Cost' }).getByRole('table').first()).toBeVisible();
  });
});
