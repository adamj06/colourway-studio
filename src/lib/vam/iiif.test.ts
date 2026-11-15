import { describe, expect, it } from 'vitest';
import { iiifImageUrl } from './iiif';

const BASE = 'https://framemark.vam.ac.uk/collections/2020MN1492/';

describe('iiifImageUrl', () => {
  it('builds the best-fit full-region jpg url', () => {
    expect(iiifImageUrl(BASE, 100, 100)).toBe(
      'https://framemark.vam.ac.uk/collections/2020MN1492/full/!100,100/0/default.jpg',
    );
  });

  it('uses width then height in the size segment', () => {
    expect(iiifImageUrl(BASE, 800, 600)).toContain('/full/!800,600/0/default.jpg');
  });

  it('accepts the boundary sizes 1 and 4000', () => {
    expect(iiifImageUrl(BASE, 1, 4000)).toContain('!1,4000');
    expect(iiifImageUrl(BASE, 4000, 1)).toContain('!4000,1');
  });

  it('accepts ids with underscores and hyphens', () => {
    expect(() => iiifImageUrl('https://framemark.vam.ac.uk/collections/a_B-9/', 10, 10)).not.toThrow();
  });

  it.each([
    ['http scheme', 'http://framemark.vam.ac.uk/collections/2020MN1492/'],
    ['other host', 'https://example.com/collections/2020MN1492/'],
    ['lookalike suffix', 'https://framemark.vam.ac.uk.evil.com/collections/2020MN1492/'],
    ['lookalike prefix', 'https://evilframemark.vam.ac.uk/collections/2020MN1492/'],
    ['userinfo', 'https://user@framemark.vam.ac.uk/collections/2020MN1492/'],
    ['userinfo trick', 'https://framemark.vam.ac.uk@evil.com/collections/2020MN1492/'],
    ['query', 'https://framemark.vam.ac.uk/collections/2020MN1492/?x=1'],
    ['fragment', 'https://framemark.vam.ac.uk/collections/2020MN1492/#x'],
    ['port', 'https://framemark.vam.ac.uk:8443/collections/2020MN1492/'],
    ['missing trailing slash', 'https://framemark.vam.ac.uk/collections/2020MN1492'],
    ['extra path segment', 'https://framemark.vam.ac.uk/collections/2020MN1492/full/'],
    ['path traversal', 'https://framemark.vam.ac.uk/collections/../admin/'],
    ['encoded slash id', 'https://framemark.vam.ac.uk/collections/a%2Fb/'],
    ['empty id', 'https://framemark.vam.ac.uk/collections//'],
    ['wrong prefix', 'https://framemark.vam.ac.uk/other/2020MN1492/'],
    ['empty string', ''],
    ['not a url', 'nonsense'],
  ])('rejects a base url with %s', (_label, base) => {
    expect(() => iiifImageUrl(base, 100, 100)).toThrow();
  });

  it.each([0, -1, 4001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects width %s', (w) => {
    expect(() => iiifImageUrl(BASE, w, 100)).toThrow();
  });

  it.each([0, -1, 4001, 1.5, Number.NaN])('rejects height %s', (h) => {
    expect(() => iiifImageUrl(BASE, 100, h)).toThrow();
  });
});
