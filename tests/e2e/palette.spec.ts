import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { indianDesign, mockVam } from './mock-vam';
import { bandsPng, checkerboardPng } from './png';

const RED = '#C0392B';
const BLUE = '#2E86C1';
const FIVE = [RED, BLUE, '#27AE60', '#F1C40F', '#8E44AD'] as const;

const designUrl = `/design/${indianDesign.systemNumber}`;
const status = (page: Page) => page.getByRole('status').filter({ hasText: /palette|extracting|copied/i });
const swatches = (page: Page) => page.getByRole('button', { name: /^Colour \d+ of \d+, #[0-9A-F]{6}, / });
const kOption = (page: Page, k: number) => page.locator('label', { hasText: new RegExp(`^${String(k)}$`) });

test.describe('palette on the design page', () => {
  test('a 2-colour checkerboard gives exactly those 2 swatches at 50% @smoke', async ({ page }) => {
    await mockVam(page, { imagePng: checkerboardPng(RED, BLUE) });
    await page.goto(designUrl);

    await expect(status(page)).toHaveText('Palette ready: 2 colours');
    await expect(swatches(page)).toHaveCount(2);
    const labels = await swatches(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(labels.sort()).toEqual([
      `Colour 1 of 2, ${BLUE.toUpperCase()}, 50% of the design`,
      `Colour 2 of 2, ${RED.toUpperCase()}, 50% of the design`,
    ]);
  });

  test('defaults to 6 colours and changing k updates the palette', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng(FIVE) });
    await page.goto(designUrl);

    await expect(page.getByRole('radio', { name: '6' })).toBeChecked();
    await expect(status(page)).toHaveText('Palette ready: 5 colours');

    await kOption(page, 4).click();
    await expect(status(page)).toHaveText('Palette ready: 4 colours');
    await expect(swatches(page)).toHaveCount(4);

    await kOption(page, 8).click();
    await expect(status(page)).toHaveText('Palette ready: 5 colours');
    await expect(swatches(page)).toHaveCount(5);
  });

  test('rapid k changes end on the last choice only', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng(FIVE) });
    await page.goto(designUrl);
    await expect(status(page)).toHaveText('Palette ready: 5 colours');

    await kOption(page, 8).click();
    await kOption(page, 5).click();
    await kOption(page, 4).click();

    await expect(status(page)).toHaveText('Palette ready: 4 colours');
    await page.waitForTimeout(400); // a late answer for an older k would flip this
    await expect(swatches(page)).toHaveCount(4);
    await expect(status(page)).toHaveText('Palette ready: 4 colours');
  });

  test('a swatch copies its hex by keyboard and announces it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockVam(page, { imagePng: checkerboardPng(RED, BLUE) });
    await page.goto(designUrl);
    await expect(status(page)).toHaveText('Palette ready: 2 colours');

    const first = swatches(page).first();
    const hex = /#[0-9A-F]{6}/.exec((await first.getAttribute('aria-label')) ?? '')?.[0];
    expect(hex).toBeDefined();
    await first.focus();
    await page.keyboard.press('Enter');

    await expect(status(page)).toHaveText(`Copied ${hex ?? ''}`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(hex);
  });

  test('k can be changed with the keyboard', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng(FIVE) });
    await page.goto(designUrl);
    await expect(status(page)).toHaveText('Palette ready: 5 colours');

    await page.getByRole('radio', { name: '6' }).focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: '4' })).toBeChecked();
    await expect(status(page)).toHaveText('Palette ready: 4 colours');
  });

  test('has no serious or critical accessibility violations with the palette showing', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng(FIVE) });
    await page.goto(designUrl);
    await expect(status(page)).toHaveText('Palette ready: 5 colours');

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad, `Serious/critical a11y violations: ${bad.map((v) => v.id).join(', ')}`).toHaveLength(0);
  });
});
