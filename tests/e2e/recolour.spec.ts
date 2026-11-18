import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { indianDesign, mockVam } from './mock-vam';
import { bandsPng, checkerboardPng } from './png';

const RED = '#C0392B';
const BLUE = '#2E86C1';
const GREEN = '#00FF00';
const FIVE = [RED, BLUE, '#27AE60', '#F1C40F', '#8E44AD'] as const;

const designUrl = `/design/${indianDesign.systemNumber}`;
const status = (page: Page) => page.getByRole('status').filter({ hasText: /palette|extracting|copied|colour/i });
const picker = (page: Page, hex: string) =>
  page.getByLabel(new RegExp(`^Colour \\d+ of \\d+, ${hex}, .* of the design\\. Change colour$`, 'i'));
const recoloured = (page: Page) => page.getByRole('img', { name: /, recoloured$/ });
const kOption = (page: Page, k: number) => page.locator('label', { hasText: new RegExp(`^${String(k)}$`) });

/** Every distinct colour on the recoloured canvas, as [r, g, b]. */
async function canvasColours(page: Page): Promise<number[][]> {
  return recoloured(page).evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<string>();
    for (let i = 0; data && i < data.length; i += 4) seen.add(Array.from(data.subarray(i, i + 3)).join(','));
    return [...seen].map((key) => key.split(',').map(Number));
  });
}

const near = (colour: number[], hex: string, tolerance: number): boolean => {
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return want.every((value, i) => Math.abs((colour[i] ?? 0) - value) <= tolerance);
};

async function openChecker(page: Page) {
  await mockVam(page, { imagePng: checkerboardPng(RED, BLUE) });
  await page.goto(designUrl);
  await expect(status(page)).toHaveText('Palette ready: 2 colours');
}

test.describe('recolouring on the design page', () => {
  test('changing a swatch recolours the design and the original comes back @smoke', async ({ page }) => {
    await openChecker(page);
    await expect(recoloured(page)).toHaveCount(0);

    await picker(page, RED).fill(GREEN);

    await expect(recoloured(page)).toBeVisible();
    await expect(status(page)).toHaveText(/^Colour \d changed to #00FF00$/);
    await expect.poll(async () => (await canvasColours(page)).some((c) => near(c, GREEN, 24))).toBe(true);
    expect((await canvasColours(page)).some((c) => near(c, RED, 24))).toBe(false);
    expect((await canvasColours(page)).some((c) => near(c, BLUE, 24))).toBe(true);

    const original = page.getByRole('button', { name: 'Show original' });
    await original.click();
    await expect(original).toHaveAttribute('aria-pressed', 'true');
    await expect(recoloured(page)).toHaveCount(0);
    await original.click();
    await expect(recoloured(page)).toBeVisible();

    await page.getByRole('button', { name: 'Reset all colours' }).click();
    await expect(status(page)).toHaveText('All colours reset');
    await expect(recoloured(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Palette' })).toBeFocused();
  });

  test('an edited swatch shows its original colour and resets on its own, keeping focus', async ({ page }) => {
    await openChecker(page);
    await picker(page, RED).fill(GREEN);
    await expect(page.getByText(`Original ${RED}`)).toBeVisible();

    await page.getByRole('button', { name: /^Reset colour \d$/ }).click();

    await expect(status(page)).toHaveText(/^Colour \d reset$/);
    await expect(recoloured(page)).toHaveCount(0);
    await expect(page.getByText(`Original ${RED}`)).toHaveCount(0);
    await expect(picker(page, RED)).toBeFocused();
  });

  test('changing the number of colours clears the edits and says so', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng(FIVE) });
    await page.goto(designUrl);
    await expect(status(page)).toHaveText('Palette ready: 5 colours');
    await picker(page, RED).fill(GREEN);
    await expect(recoloured(page)).toBeVisible();

    await kOption(page, 4).click();

    await expect(status(page)).toHaveText('Colour changes cleared');
    await expect(recoloured(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset all colours' })).toHaveCount(0);
  });

  test('the Copy button copies the current colour of a swatch', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openChecker(page);
    await picker(page, RED).fill(GREEN);
    await expect(recoloured(page)).toBeVisible();

    await page.getByRole('button', { name: `Copy ${GREEN}` }).click();

    await expect(status(page)).toHaveText(`Copied ${GREEN}`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(GREEN);
  });

  test('has no serious or critical accessibility violations with a colour changed', async ({ page }) => {
    await openChecker(page);
    await picker(page, RED).fill(GREEN);
    await expect(recoloured(page)).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad, `Serious/critical a11y violations: ${bad.map((v) => v.id).join(', ')}`).toHaveLength(0);
  });

  test('keeps the original image and offers a retry when the recolour worker cannot load', async ({ page }) => {
    await openChecker(page);
    // The palette worker has loaded by now. Fail the next worker script request, which is the recolour worker's.
    let blockWorker = true;
    await page.route('**/turbopack-worker-*.js', (route) => (blockWorker ? route.abort() : route.continue()));

    await picker(page, RED).fill(GREEN);

    const alert = page.getByRole('alert').filter({ hasText: /couldn’t recolour/ });
    await expect(alert).toBeVisible();
    await expect(recoloured(page)).toHaveCount(0);
    await expect(page.getByRole('img', { name: /Indian|wallpaper|design/i }).first()).toBeVisible();

    blockWorker = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('body')).not.toBeFocused();
    await expect(recoloured(page)).toBeVisible();
    await expect(alert).toHaveCount(0);
  });
});
