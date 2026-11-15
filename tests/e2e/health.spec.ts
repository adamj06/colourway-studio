import { expect, test } from './fixtures';

test.describe('health', () => {
  test('GET /api/health reports a version and V&A reachability @smoke', async ({ request }) => {
    const response = await request.get('/api/health');
    // 200 even when the V&A is down: the app is up, reachability is reported rather than enforced.
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      version: string;
      vam: { reachable: boolean; latencyMs: number; checkedAt: string };
    };
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.vam.reachable).toBe('boolean');
    expect(typeof body.vam.latencyMs).toBe('number');
    expect(Number.isNaN(Date.parse(body.vam.checkedAt))).toBe(false);
  });

  test('typed error JSON for bad input, never a stack trace', async ({ request }) => {
    const response = await request.get('/api/vam/search?page=0');
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_input' } });

    const object = await request.get('/api/vam/object/not-an-id');
    expect(object.status()).toBe(400);
    expect(await object.text()).not.toMatch(/\bat \S+ \(|node_modules/);
  });
});
