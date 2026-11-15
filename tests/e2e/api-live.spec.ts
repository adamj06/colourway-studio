import { expect, test } from './fixtures';

// No mocks: these go through the real route handlers, the `use cache` boundary and the real V&A. They exist
// because every mocked layer once hid a bug where each V&A error (including "not found") turned into a 500.
// Tagged @external so the PR e2e job (which must not depend on a third party) skips them; smoke and contract run them.

test.describe('live API routes', () => {
  test('@external @smoke search returns designs with images', async ({ request }) => {
    const response = await request.get('/api/vam/search?q=strawberry');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { items: { systemNumber: string; imageBaseUrl: string }[]; total: number };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]!.imageBaseUrl).toMatch(/^https:\/\/framemark\.vam\.ac\.uk\/collections\//);
  });

  test('@external @smoke a known design is returned with designers kept apart from manufacturers', async ({
    request,
  }) => {
    const response = await request.get('/api/vam/object/O78207');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      systemNumber: 'O78207',
      title: 'Indian',
      designers: ['Morris, William'],
    });
  });

  test('@external @smoke a design without images is a 404, not a 500', async ({ request }) => {
    const response = await request.get('/api/vam/object/O270961');
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  test('@external @smoke an unknown design is a 404, not a 500', async ({ request }) => {
    const response = await request.get('/api/vam/object/O99999999');
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
