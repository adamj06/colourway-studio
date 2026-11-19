// Feature 005 (share + export), e2e. Expected to exist in the app (none of it does yet):
//  - After an edit settles (SETTLE_MS = 250), the page URL gains `?cw=<encodeColourway(state)>` via history.replaceState
//    (no new history entries). Reset all, or changing the number of colours, removes `cw`.
//  - Opening the design page with a valid `cw` shows that palette and recolours with no palette extraction (the main
//    thread never posts `analyse-bitmap` to the palette worker). An invalid `cw` is ignored with a polite
//    role=status message "This link’s colours couldn’t be read, so the original palette is shown."
//  - A "Copy link" button (clipboard, with an aria-live "Link copied" announcement; on failure a read-only text field
//    holding the URL) and an "Export PNG" button (disabled, with an accessible description, until the settled
//    full-quality frame exists) that downloads `<systemNumber>-colourway.png` with tEXt chunks Source and Software.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decodeColourway, encodeColourway } from '../../src/lib/colourway/url';
import { expect, test } from './fixtures';
import { indianDesign, mockVam } from './mock-vam';
import { bandsPng, checkerboardPng, parsePng } from './png';

const RED = '#C0392B';
const BLUE = '#2E86C1';
const GREEN = '#00FF00';
const MAGENTA = '#FF00FF';
const CYAN = '#00FFFF';
const THREE = [RED, BLUE, '#27AE60'] as const;
const SETTLE_WAIT = 5_000; // generous: SETTLE_MS is 250, plus a full-quality recolour

const designUrl = `/design/${indianDesign.systemNumber}`;
const ready = (page: Page, count: number) =>
  page.getByRole('status').filter({ hasText: `Palette ready: ${String(count)} colours` });
const picker = (page: Page, hex: string) =>
  page.getByLabel(new RegExp(`^Colour \\d+ of \\d+, ${hex}, .* of the design\\. Change colour$`, 'i'));
const recoloured = (page: Page) => page.getByRole('img', { name: /, recoloured$/ });
const kOption = (page: Page, k: number) => page.locator('label', { hasText: new RegExp(`^${String(k)}$`) });
const cwOf = (page: Page): string | null => new URL(page.url()).searchParams.get('cw');
const copyLink = (page: Page) => page.getByRole('button', { name: 'Copy link' });
const exportPng = (page: Page) => page.getByRole('button', { name: /^Export PNG/ });
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

/** Records the `type` of every message the main thread posts to any Worker, to tell the two workers apart. */
async function recordWorkerMessages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __workerMessages: string[] }).__workerMessages = seen;
    const original = Worker.prototype.postMessage;
    (Worker.prototype as { postMessage: unknown }).postMessage = function (this: Worker, ...args: unknown[]) {
      const message = args[0] as { type?: unknown } | null;
      seen.push(String(message?.type));
      return Reflect.apply(original, this, args) as unknown;
    };
  });
}
const workerMessages = (page: Page) =>
  page.evaluate(() => (window as unknown as { __workerMessages: string[] }).__workerMessages);

async function canvasColours(page: Page): Promise<number[][]> {
  return recoloured(page).evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<string>();
    for (let i = 0; data && i < data.length; i += 4) seen.add(Array.from(data.subarray(i, i + 3)).join(','));
    return [...seen].map((key) => key.split(',').map(Number));
  });
}
const near = (colour: number[], hex: string, tolerance: number): boolean =>
  [1, 3, 5].every((at, i) => Math.abs((colour[i] ?? 0) - parseInt(hex.slice(at, at + 2), 16)) <= tolerance);

async function openChecker(page: Page) {
  await mockVam(page, { imagePng: checkerboardPng(RED, BLUE) });
  await page.goto(designUrl);
  await expect(ready(page, 2)).toBeVisible();
}

async function editAndSettle(page: Page, from: string, to: string) {
  await picker(page, from).fill(to);
  await expect(recoloured(page)).toBeVisible();
  await expect.poll(() => cwOf(page), { timeout: SETTLE_WAIT }).not.toBeNull();
}

test.describe('the colourway in the URL', () => {
  test('an edit adds a cw param that decodes to the palette with the edit, without adding history @smoke', async ({
    page,
  }) => {
    await openChecker(page);
    expect(cwOf(page)).toBeNull();
    const before = await historyLength(page);

    await picker(page, RED).fill(GREEN);
    await expect(recoloured(page)).toBeVisible();
    await picker(page, GREEN).fill(MAGENTA);
    await picker(page, MAGENTA).fill(CYAN);
    await expect
      .poll(() => Object.values(decodeColourway(cwOf(page) ?? '')?.edits ?? {}), { timeout: SETTLE_WAIT })
      .toEqual([CYAN]);

    const decoded = decodeColourway(cwOf(page) ?? '');
    expect([...(decoded?.original ?? [])].sort()).toEqual([BLUE, RED].sort());
    const editedIndex = Number(Object.keys(decoded?.edits ?? {})[0]);
    expect(decoded?.original[editedIndex]).toBe(RED);
    expect(await historyLength(page)).toBe(before);
  });

  test('Reset all colours removes the cw param', async ({ page }) => {
    await openChecker(page);
    await editAndSettle(page, RED, GREEN);

    await page.getByRole('button', { name: 'Reset all colours' }).click();

    await expect.poll(() => cwOf(page), { timeout: SETTLE_WAIT }).toBeNull();
  });

  test('changing the number of colours removes the cw param', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng([RED, BLUE, '#27AE60', '#F1C40F', '#8E44AD']) });
    await page.goto(designUrl);
    await expect(ready(page, 5)).toBeVisible();
    await editAndSettle(page, RED, GREEN);

    await kOption(page, 4).click();

    await expect.poll(() => cwOf(page), { timeout: SETTLE_WAIT }).toBeNull();
  });

  test('opening a link with cw shows the same swatches and recoloured design without extracting a palette @smoke', async ({
    page,
    context,
  }) => {
    await recordWorkerMessages(page);
    await openChecker(page);
    expect(await workerMessages(page), 'the probe sees palette extraction on a normal load').toContain(
      'analyse-bitmap',
    );
    await editAndSettle(page, RED, GREEN);
    const link = page.url();

    const fresh = await context.newPage();
    await recordWorkerMessages(fresh);
    await mockVam(fresh, { imagePng: checkerboardPng(RED, BLUE) });
    await fresh.goto(link);

    await expect(picker(fresh, GREEN)).toBeVisible();
    await expect(picker(fresh, BLUE)).toBeVisible();
    await expect(fresh.getByText(`Original ${RED}`)).toBeVisible();
    await expect(recoloured(fresh)).toBeVisible();
    await expect.poll(async () => (await canvasColours(fresh)).some((c) => near(c, GREEN, 24))).toBe(true);
    expect((await canvasColours(fresh)).some((c) => near(c, RED, 24))).toBe(false);
    const messages = await workerMessages(fresh);
    expect(messages, 'no palette extraction ran').not.toContain('analyse-bitmap');
    expect(messages, 'the recolour worker did run').toContain('prepare-bitmap');
    await fresh.close();
  });

  test('a link built from the encoder recolours too', async ({ page }) => {
    const cw = encodeColourway({ original: [RED, BLUE], edits: { 0: GREEN } });
    await mockVam(page, { imagePng: checkerboardPng(RED, BLUE) });
    await page.goto(`${designUrl}?cw=${cw}`);

    await expect(picker(page, GREEN)).toBeVisible();
    await expect(recoloured(page)).toBeVisible();
  });

  test('an invalid cw is ignored with a polite message and the normal palette', async ({ page }) => {
    await recordWorkerMessages(page);
    await mockVam(page, { imagePng: checkerboardPng(RED, BLUE) });
    await page.goto(`${designUrl}?cw=not-a-colourway`);

    await expect(ready(page, 2)).toBeVisible();
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'This link’s colours couldn’t be read, so the original palette is shown.' });
    await expect(notice).toBeVisible();
    await expect(picker(page, RED)).toBeVisible();
    await expect(recoloured(page)).toHaveCount(0);
    // Next's own route announcer is an empty role=alert on every page: only an alert with text is an error message.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await workerMessages(page)).toContain('analyse-bitmap');
  });
});

test.describe('Copy link', () => {
  test('copies the current absolute URL and announces it politely', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openChecker(page);
    await editAndSettle(page, RED, GREEN);

    await copyLink(page).click();

    await expect(
      page.locator('[aria-live="polite"], [role="status"]').filter({ hasText: 'Link copied' }),
    ).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(page.url());
    expect(copied).toMatch(/^https?:\/\//);
    expect(new URL(copied).searchParams.get('cw')).toBe(cwOf(page));
  });

  test('shows a read-only text field with the URL when the clipboard write fails', async ({ page }) => {
    await openChecker(page);
    await editAndSettle(page, RED, GREEN);
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      });
    });

    await copyLink(page).click();

    const field = page.getByRole('textbox', { name: /link/i });
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('readonly', '');
    await expect(field).toHaveValue(page.url());
    await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toHaveCount(0);
  });
});

test.describe('Export PNG', () => {
  test('is disabled with an accessible reason until the full-quality frame exists', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng(THREE) });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Registered after mockVam, so it runs first and holds the image back until released.
    await page.route('https://framemark.vam.ac.uk/**', async (route) => {
      await gate;
      await route.fallback();
    });
    await page.goto(designUrl);

    await expect(exportPng(page)).toBeDisabled();
    await expect(exportPng(page)).toHaveAccessibleDescription(/\S/);

    release();
    await expect(ready(page, 3)).toBeVisible();
    await expect(exportPng(page)).toBeEnabled();
  });

  test('downloads a valid PNG of the recoloured canvas with Source and Software text chunks @smoke', async ({
    page,
  }) => {
    await mockVam(page, { imagePng: bandsPng(THREE) });
    await page.goto(designUrl);
    await expect(ready(page, 3)).toBeVisible();
    await editAndSettle(page, RED, GREEN);
    await expect(exportPng(page)).toBeEnabled({ timeout: SETTLE_WAIT });
    const size = await recoloured(page).evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));

    const [download] = await Promise.all([page.waitForEvent('download'), exportPng(page).click()]);

    expect(download.suggestedFilename()).toBe(`${indianDesign.systemNumber}-colourway.png`);
    const bytes = readFileSync(await download.path());
    const png = parsePng(bytes);
    expect(png.width).toBe(size.width);
    expect(png.height).toBe(size.height);
    expect(Math.max(png.width, png.height)).toBeLessThanOrEqual(1600);
    expect(png.width, 'the 60x100 source is portrait').toBeLessThan(png.height);
    expect(png.chunks.map((c) => c.type)).toContain('IDAT');
    expect(png.chunks.at(-1)?.type).toBe('IEND');
    expect(png.text.Source).toBe(`Victoria and Albert Museum, London (${indianDesign.systemNumber})`);
    expect(png.text.Software).toBe('Colourway Studio');

    // The pixels are the recoloured ones: decode the file in the browser and look for green, but no red.
    const colours = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      const data = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set<string>();
      for (let i = 0; data && i < data.length; i += 4) seen.add(Array.from(data.subarray(i, i + 3)).join(','));
      return [...seen].map((key) => key.split(',').map(Number));
    }, bytes.toString('base64'));
    expect(colours.some((c) => near(c, GREEN, 24))).toBe(true);
    expect(colours.some((c) => near(c, RED, 24))).toBe(false);
  });

  test('still exports a valid PNG when nothing has been edited', async ({ page }) => {
    await mockVam(page, { imagePng: bandsPng(THREE) });
    await page.goto(designUrl);
    await expect(ready(page, 3)).toBeVisible();
    await expect(exportPng(page)).toBeEnabled({ timeout: SETTLE_WAIT });

    const [download] = await Promise.all([page.waitForEvent('download'), exportPng(page).click()]);

    expect(download.suggestedFilename()).toBe(`${indianDesign.systemNumber}-colourway.png`);
    const png = parsePng(readFileSync(await download.path()));
    expect(png.width).toBeGreaterThan(0);
    expect(png.height).toBeGreaterThan(0);
    expect(Math.max(png.width, png.height)).toBeLessThanOrEqual(1600);
    expect(png.width / png.height).toBeCloseTo(60 / 100, 2);
    expect(png.text.Source).toBe(`Victoria and Albert Museum, London (${indianDesign.systemNumber})`);
    expect(png.text.Software).toBe('Colourway Studio');
  });
});

test('has no serious or critical accessibility violations with edits applied and the share controls shown', async ({
  page,
}) => {
  await openChecker(page);
  await editAndSettle(page, RED, GREEN);
  await expect(copyLink(page)).toBeVisible();
  await expect(exportPng(page)).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad, `Serious/critical a11y violations: ${bad.map((v) => v.id).join(', ')}`).toHaveLength(0);
});
