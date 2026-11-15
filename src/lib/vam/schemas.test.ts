import { describe, expect, it } from 'vitest';
import { loadFixture, OBJECT_FIXTURES, SEARCH_FIXTURES } from '../../../tests/helpers/fixtures';
import { objectResponseSchema, searchResponseSchema } from './schemas';

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('searchResponseSchema', () => {
  it.each(SEARCH_FIXTURES)('parses the real fixture %s', (name) => {
    expect(searchResponseSchema.safeParse(loadFixture(name)).success).toBe(true);
  });

  it('rejects a response without info', () => {
    const raw = clone(loadFixture('search-org-A1365-images-p1.json')) as Record<string, unknown>;
    delete raw.info;
    expect(searchResponseSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a response whose records is not an array', () => {
    const raw = clone(loadFixture('search-org-A1365-images-p1.json')) as Record<string, unknown>;
    raw.records = { not: 'an array' };
    expect(searchResponseSchema.safeParse(raw).success).toBe(false);
  });

  it.each([null, 'text', 42, [], undefined])('rejects the non-object %s', (raw) => {
    expect(searchResponseSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects info with a non-numeric record_count', () => {
    const raw = clone(loadFixture('search-org-A1365-images-p1.json')) as { info: Record<string, unknown> };
    raw.info.record_count = 'many';
    expect(searchResponseSchema.safeParse(raw).success).toBe(false);
  });

  it('tolerates unknown extra fields at the top level, in info and in records', () => {
    const raw = clone(loadFixture('search-org-A1365-images-p1.json')) as {
      info: Record<string, unknown>;
      records: Record<string, unknown>[];
    };
    raw.info.brand_new = 1;
    raw.records[0]!.brand_new = { a: 1 };
    expect(searchResponseSchema.safeParse({ ...raw, surprise: true }).success).toBe(true);
  });

  it('accepts a record with an empty title, a null primary image id and no iiif base url', () => {
    const raw = clone(loadFixture('search-org-A1365-noimages-p2-size100.json'));
    const parsed = searchResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });
});

describe('objectResponseSchema', () => {
  it.each(OBJECT_FIXTURES)('parses the real fixture %s', (name) => {
    expect(objectResponseSchema.safeParse(loadFixture(name)).success).toBe(true);
  });

  it('accepts the no-image variant where meta.images is null and record.images is empty', () => {
    expect(objectResponseSchema.safeParse(loadFixture('object-no-images-O270961.json')).success).toBe(true);
  });

  it('rejects a response without record', () => {
    const raw = clone(loadFixture('museumobject-O78207.json')) as Record<string, unknown>;
    delete raw.record;
    expect(objectResponseSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects a record without a systemNumber', () => {
    const raw = clone(loadFixture('museumobject-O78207.json')) as { record: Record<string, unknown> };
    delete raw.record.systemNumber;
    expect(objectResponseSchema.safeParse(raw).success).toBe(false);
  });

  it.each([null, 'text', 7, []])('rejects the non-object %s', (raw) => {
    expect(objectResponseSchema.safeParse(raw).success).toBe(false);
  });

  it('tolerates unknown extra fields', () => {
    const raw = clone(loadFixture('museumobject-O78207.json')) as { record: Record<string, unknown> };
    raw.record.brand_new = [1, 2];
    expect(objectResponseSchema.safeParse({ ...raw, surprise: 1 }).success).toBe(true);
  });
});
