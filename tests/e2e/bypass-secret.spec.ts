import { expect, test } from './fixtures';

const BYPASS_HEADER = 'x-vercel-protection-bypass';

test.describe('deployment protection bypass secret', () => {
  test('no request the page makes carries the bypass header, same-origin or cross-origin @smoke', async ({
    page,
    baseURL,
  }) => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    page.on('request', (req) => {
      void req.allHeaders().then((headers) => seen.push({ url: req.url(), headers }));
    });
    // A third-party image request (the one cross-origin host the CSP allows), answered locally so the test never
    // touches the network.
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    await page.route('https://framemark.vam.ac.uk/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: pixel }),
    );

    await page.goto('/');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            resolve();
          };
          img.onerror = () => {
            resolve();
          };
          img.src = 'https://framemark.vam.ac.uk/iiif/test/full/50,/0/default.jpg';
        }),
    );
    await page.waitForLoadState('networkidle');

    const crossOrigin = seen.filter((r) => r.url.startsWith('https://framemark.vam.ac.uk/'));
    const sameOrigin = seen.filter((r) => baseURL && r.url.startsWith(baseURL));
    expect(crossOrigin.length, 'the cross-origin request was observed').toBeGreaterThan(0);
    expect(sameOrigin.length, 'same-origin requests were observed').toBeGreaterThan(0);
    for (const r of seen) expect(r.headers[BYPASS_HEADER], `${r.url} must not carry the bypass secret`).toBeUndefined();
  });
});
