import { describe, expect, it } from 'vitest';
import { buildSearchUrl, createVamClient, VamError } from '../../src/lib/vam/client';
import { objectResponseSchema, searchResponseSchema } from '../../src/lib/vam/schemas';

// Hits the LIVE api.vam.ac.uk. Run with `npm run test:contract`, never as part of the unit run.
const client = createVamClient({});

describe('V&A live contract', () => {
  it('search page 1 validates against searchResponseSchema via the raw API', async () => {
    const res = await fetch(buildSearchUrl({ page: 1 }), { headers: { 'User-Agent': 'colourway-studio/contract' } });
    expect(res.status).toBe(200);
    const parsed = searchResponseSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
  });

  it('searchDesigns returns a plausible Morris & Co. result set with framemark images', async () => {
    const result = await client.searchDesigns({ page: 1 });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    // Guards against silently ignored filter params returning the whole collection.
    expect(result.total).toBeGreaterThan(100);
    expect(result.total).toBeLessThan(5000);
    for (const item of result.items) {
      expect(item.imageBaseUrl.startsWith('https://framemark.vam.ac.uk/collections/')).toBe(true);
    }
  });

  it('the first search result can be fetched as a design and validates against objectResponseSchema', async () => {
    const result = await client.searchDesigns({ page: 1 });
    const first = result.items[0]!;
    const design = await client.getDesign(first.systemNumber);
    expect(design.systemNumber).toBe(first.systemNumber);

    const raw = await fetch(`https://api.vam.ac.uk/v2/object/${first.systemNumber}`, {
      headers: { 'User-Agent': 'colourway-studio/contract' },
    });
    expect(objectResponseSchema.safeParse(await raw.json()).success).toBe(true);
  });

  it('an unknown id is reported as VamError not_found', async () => {
    const err = await client.getDesign('O99999999').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(VamError);
    expect((err as VamError).code).toBe('not_found');
  });
});
