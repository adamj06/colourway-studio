// Feature 006 (wall preview), e2e. The design page has a "See it on a wall" section: the design (the recoloured one when
// colours have been changed) tiled on a wall canvas, with a repeat region (drag on a thumbnail, or four number inputs),
// a straight / half-drop choice and a repeats-across slider. The tile layout is unit tested in src/lib/wall; these tests
// check the wiring, using a two-band image so the colour at a point on the wall says which part of the image is tiled.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { indianDesign, mockVam } from './mock-vam';
import { bandsPng } from './png';

const RED = '#C0392B';
const BLUE = '#2E86C1';
const GREEN = '#00FF00';
const SETTLE_WAIT = 5_000;
// The image is half red (left), half blue (right). With the default 4 repeats across the 1200 px wall a tile is 300 px
// wide: red from x 0 to 150, blue from 150 to 300, and the next tile starts at 300.
const IN_RED = 10;
const IN_BLUE = 200;
const IN_NEXT_TILE_RED = 310;
const ROW = 10;

const designUrl = `/design/${indianDesign.systemNumber}`;
const wall = (page: Page) => page.getByRole('img', { name: /on a wall$/ });
const picker = (page: Page, hex: string) =>
  page.getByLabel(new RegExp(`^Colour \\d+ of \\d+, ${hex}, .* of the design\\. Change colour$`, 'i'));

async function wallPixel(page: Page, x: number, y: number): Promise<number[]> {
  return wall(page).evaluate(
    (canvas: HTMLCanvasElement, at) => {
      const data = canvas.getContext('2d')?.getImageData(at.x, at.y, 1, 1).data;
      return data ? Array.from(data) : [];
    },
    { x, y },
  );
}

const near = (pixel: number[], hex: string, tolerance = 40): boolean =>
  [1, 3, 5].every((at, i) => Math.abs((pixel[i] ?? 0) - parseInt(hex.slice(at, at + 2), 16)) <= tolerance);

/** Waits until the wall's pixel at `x` is this colour (the wall is painted after the image loads). */
const expectWallColour = (page: Page, x: number, hex: string) =>
  expect.poll(async () => near(await wallPixel(page, x, ROW), hex), { timeout: SETTLE_WAIT }).toBe(true);

async function openBands(page: Page) {
  await mockVam(page, { imagePng: bandsPng([RED, BLUE]) });
  await page.goto(designUrl);
  await expect(wall(page)).toBeVisible();
}

test.describe('the wall preview', () => {
  test('tiles the design as a repeat on a wall @smoke', async ({ page }) => {
    await openBands(page);

    await expect(page.getByRole('heading', { name: 'See it on a wall' })).toBeVisible();
    await expect(wall(page)).toHaveAccessibleName(/as a straight repeat on a wall$/);
    await expectWallColour(page, IN_RED, RED);
    await expectWallColour(page, IN_BLUE, BLUE);
    await expectWallColour(page, IN_NEXT_TILE_RED, RED);
  });

  test('the number inputs set the repeat region, and Use whole image puts it back', async ({ page }) => {
    await openBands(page);
    await expectWallColour(page, IN_BLUE, BLUE);

    // Only the left half (the red band) is now the repeat, so the whole wall is red.
    await page.getByLabel('Width (%)').fill('50');
    await expectWallColour(page, IN_BLUE, RED);

    await page.getByRole('button', { name: 'Use whole image' }).click();
    await expectWallColour(page, IN_BLUE, BLUE);
    await expect(page.getByLabel('Width (%)')).toHaveValue('100');
  });

  test('a region cannot be made smaller than 5% of the image', async ({ page }) => {
    await openBands(page);

    const width = page.getByLabel('Width (%)');
    await width.fill('1');
    await width.blur();

    await expect(width).toHaveValue('5');
  });

  test('dragging on the picture marks a region and updates the numbers', async ({ page }) => {
    await openBands(page);
    const thumbnail = page.getByRole('group', { name: 'Repeat region' }).locator('canvas');
    // The mouse works in viewport coordinates, so the picture has to be on screen before it is measured.
    await thumbnail.scrollIntoViewIfNeeded();
    const box = await thumbnail.boundingBox();
    expect(box).not.toBeNull();
    const { x, y, width, height } = box!;

    await page.mouse.move(x + width * 0.1, y + height * 0.2);
    await page.mouse.down();
    await page.mouse.move(x + width * 0.6, y + height * 0.7, { steps: 5 });
    await page.mouse.up();

    const value = async (label: string) => Number(await page.getByLabel(label).inputValue());
    expect(await value('Left (%)')).toBeCloseTo(10, 0);
    expect(await value('Top (%)')).toBeCloseTo(20, 0);
    expect(await value('Width (%)')).toBeCloseTo(50, 0);
    expect(await value('Height (%)')).toBeCloseTo(50, 0);
  });

  test('half-drop is a choice, and the wall says which repeat it shows', async ({ page }) => {
    await openBands(page);

    await page.getByRole('radio', { name: 'Half-drop' }).check();

    await expect(wall(page)).toHaveAccessibleName(/as a half-drop repeat on a wall$/);
    await expectWallColour(page, IN_RED, RED);
  });

  test('more repeats across make the tiles narrower', async ({ page }) => {
    await openBands(page);
    await expectWallColour(page, IN_BLUE, BLUE);

    // 10 repeats: tiles are 120 px wide, red from x 0 to 60 and blue from 60 to 120, so x 100 is blue and x 130 (10 px
    // into the second tile) is red.
    await page.getByLabel(/^Repeats across the wall/).fill('10');

    await expectWallColour(page, 100, BLUE);
    await expectWallColour(page, 130, RED);
  });

  test('shows a recoloured design, and the original again with Show original', async ({ page }) => {
    await openBands(page);
    await expectWallColour(page, IN_RED, RED);

    await picker(page, RED).fill(GREEN);

    await expectWallColour(page, IN_RED, GREEN);
    await expect(wall(page)).toHaveAccessibleName(/, recoloured, as a straight repeat on a wall$/);

    await page.getByRole('button', { name: 'Show original' }).click();
    await expectWallColour(page, IN_RED, RED);
  });

  test('has no serious accessibility violations', async ({ page }) => {
    await openBands(page);
    await expectWallColour(page, IN_RED, RED);

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
