import { expect, test } from './fixtures';

// @external: talks to the REAL framemark.vam.ac.uk. Runs in the contract and smoke workflows (RUN_EXTERNAL=1), never
// in the PR e2e job. It proves the ADR 0002 assumption: an image loaded with crossOrigin="anonymous" from a
// different origin can be read back from a canvas without a SecurityError.
const IMAGE = 'https://framemark.vam.ac.uk/collections/2020MN1492/full/!100,100/0/default.jpg';
const FAKE_APP_ORIGIN = 'http://app.colourway.test';

test('@external a framemark IIIF image can be drawn to a canvas and read with getImageData', async ({ page }) => {
  // A different origin from framemark, so the browser really applies CORS (no local app server needed).
  await page.route(`${FAKE_APP_ORIGIN}/`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }),
  );
  await page.goto(`${FAKE_APP_ORIGIN}/`);

  const result = await page.evaluate(async (src) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    try {
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return { ok: true as const, width: img.naturalWidth, alpha: data[3] };
    } catch (error) {
      return { ok: false as const, name: error instanceof Error ? error.name : 'unknown' };
    }
  }, IMAGE);

  expect(result, 'getImageData must not throw (a SecurityError means the canvas is tainted)').toMatchObject({
    ok: true,
  });
  if (result.ok) expect(result.width).toBeGreaterThan(0);
});
