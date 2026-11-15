import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mapObjectResponse, mapSearchResponse } from '../../src/lib/vam/map';

// Playwright loads specs as CommonJS, so tests/helpers/fixtures.ts (which uses import.meta) can't be shared here.
const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, '..', 'fixtures', 'vam', name), 'utf8')) as unknown;

// PR e2e never touches the real V&A: our /api/vam/* routes are mocked in the browser, and framemark images are
// answered with a 1x1 PNG. (The one real-network check is external-canvas.spec.ts, tagged @external.)
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO44Wf8HwAFsgJ5Zk0nWQAAAABJRU5ErkJggg==',
  'base64',
);

export const searchResult = mapSearchResponse(loadFixture('search-morris-wallpaper.json'));
export const indianDesign = mapObjectResponse(loadFixture('museumobject-O78207.json'))!;

export type MockOptions = { searchStatus?: number; objectStatus?: number };

export async function mockVam(page: Page, options: MockOptions = {}): Promise<{ searchUrls: string[] }> {
  const searchUrls: string[] = [];

  await page.route('https://framemark.vam.ac.uk/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: PIXEL_PNG,
    }),
  );

  await page.route('**/api/vam/search**', (route) => {
    searchUrls.push(route.request().url());
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (options.searchStatus && options.searchStatus >= 400) {
      return route.fulfill({
        status: options.searchStatus,
        json: { error: { code: 'upstream', message: 'down' } },
      });
    }
    const body = q === 'nomatch' ? { items: [], page: 1, totalPages: 0, total: 0 } : searchResult;
    return route.fulfill({ status: 200, json: body });
  });

  await page.route('**/api/vam/object/**', (route) => {
    const id = route.request().url().split('/').pop();
    if (options.objectStatus && options.objectStatus >= 400) {
      return route.fulfill({ status: options.objectStatus, json: { error: { code: 'x', message: 'x' } } });
    }
    if (id !== indianDesign.systemNumber) {
      return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'nope' } } });
    }
    return route.fulfill({ status: 200, json: indianDesign });
  });

  return { searchUrls };
}
