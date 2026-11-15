import { describe, expect, it } from 'vitest';
import { loadFixture, SEARCH_FIXTURES } from '../../../tests/helpers/fixtures';
import { htmlToText, mapObjectResponse, mapSearchResponse } from './map';

const FRAMEMARK = 'https://framemark.vam.ac.uk/collections/';

describe('mapSearchResponse', () => {
  it('maps a Morris wallpaper search record to a DesignSummary', () => {
    const result = mapSearchResponse(loadFixture('search-morris-wallpaper.json'));
    expect(result.items[0]).toEqual({
      systemNumber: 'O78207',
      title: 'Indian',
      designer: 'Morris, William',
      date: 'ca. 1868-70',
      objectType: 'Wallpaper sample',
      imageBaseUrl: 'https://framemark.vam.ac.uk/collections/2020MN1492/',
    });
  });

  it('takes page, totalPages and total from info', () => {
    const result = mapSearchResponse(loadFixture('search-org-A1365-images-p1.json'));
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(154);
    expect(result.total).toBe(769);
    expect(result.items).toHaveLength(5);
  });

  it('falls back to "Untitled <objectType>" when the primary title is empty', () => {
    const result = mapSearchResponse(loadFixture('search-org-A1365-images-p1.json'));
    const first = result.items[0]!;
    expect(first.systemNumber).toBe('O1520825');
    expect(first.title).toBe('Untitled Tumbler');
  });

  it('drops records with a null primary image id or without an iiif base url', () => {
    const result = mapSearchResponse(loadFixture('search-org-A1365-noimages-p2-size100.json'));
    expect(result.items.map((i) => i.systemNumber)).toEqual(['O270957', 'O270956']);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(12);
    expect(result.total).toBe(1164);
  });

  it('returns no items, zero pages but the requested page for a page past the end', () => {
    const result = mapSearchResponse(loadFixture('search-empty-result.json'));
    expect(result.items).toEqual([]);
    expect(result.totalPages).toBe(0);
    expect(result.page).toBe(100);
  });

  it.each(SEARCH_FIXTURES)('every item from %s has an https framemark image base url', (name) => {
    for (const item of mapSearchResponse(loadFixture(name)).items) {
      expect(item.imageBaseUrl.startsWith(FRAMEMARK)).toBe(true);
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it('uses the primary maker name as designer even when the association is not a designer', () => {
    const result = mapSearchResponse(loadFixture('search-org-A1365-images-p1.json'));
    expect(result.items[2]!.designer).toBe('Morris & Co');
  });

  it('trims names and returns null designer and date when absent', () => {
    const raw = structuredClone(loadFixture('search-morris-wallpaper.json')) as {
      records: Record<string, unknown>[];
    };
    raw.records[0]!._primaryMaker = { name: '  Morris, William  ', association: 'designer' };
    delete raw.records[1]!._primaryMaker;
    delete raw.records[1]!._primaryDate;
    const result = mapSearchResponse(raw);
    expect(result.items[0]!.designer).toBe('Morris, William');
    expect(result.items[1]!.designer).toBeNull();
    expect(result.items[1]!.date).toBeNull();
  });

  it('throws on garbage input', () => {
    expect(() => mapSearchResponse({ nonsense: true })).toThrow();
    expect(() => mapSearchResponse(null)).toThrow();
  });
});

describe('mapObjectResponse', () => {
  it('maps the Indian wallpaper sample (O78207) to a Design', () => {
    const design = mapObjectResponse(loadFixture('museumobject-O78207.json'))!;
    expect(design.systemNumber).toBe('O78207');
    expect(design.title).toBe('Indian');
    expect(design.objectType).toBe('Wallpaper sample');
    expect(design.designers).toEqual(['Morris, William']);
    expect(design.manufacturers).not.toContain('Morris, William');
    expect(design.date).toBe('ca. 1868-70');
    expect(design.materials).toBe('Colour woodblock print on paper');
    expect(design.dimensions).toBe('Height 68.6 cm, Width 50 cm');
    expect(design.imageBaseUrl).toBe('https://framemark.vam.ac.uk/collections/2020MN1492/');
    expect(design.creditLine).toBe('Bequeathed by J. R. Holliday');
    expect(design.collectionUrl).toBe('https://collections.vam.ac.uk/item/O78207/');
  });

  it('turns the O78207 summary into plain text with decoded entities', () => {
    const design = mapObjectResponse(loadFixture('museumobject-O78207.json'))!;
    expect(design.description).not.toBeNull();
    expect(design.description).not.toContain('<');
    expect(design.description).not.toContain('&amp;');
    expect(design.description).toContain('Design & Designing');
    expect(design.description).toContain('\n\n');
  });

  it('puts Dearle in designers and Morris & Co. only in manufacturers (O78101)', () => {
    const design = mapObjectResponse(loadFixture('object-dearle-O78101.json'))!;
    expect(design.designers).toContain('John Henry Dearle');
    expect(design.designers).not.toContain('Morris & Co.');
    expect(design.manufacturers).toContain('Morris & Co.');
  });

  it('ignores artist entries with an empty name', () => {
    const design = mapObjectResponse(loadFixture('object-dearle-O78101.json'))!;
    expect(design.manufacturers).toEqual(['Morris & Co.']);
    expect(design.designers).toEqual(['John Henry Dearle']);
  });

  it('falls back to "Untitled <objectType>" when there are no titles (O78101)', () => {
    const design = mapObjectResponse(loadFixture('object-dearle-O78101.json'))!;
    expect(design.title).toBe('Untitled Screen');
  });

  it('joins every dimension with unit, e.g. Height 162.9 cm', () => {
    const design = mapObjectResponse(loadFixture('object-dearle-O78101.json'))!;
    expect(design.dimensions).toBe('Height 162.9 cm, Width 166.2 cm, Depth 2.8 cm, Weight 32.5 kg');
  });

  it('maps Trellis (O248458) with two designers and a manufacturer role', () => {
    const design = mapObjectResponse(loadFixture('museumobject-O248458.json'))!;
    expect(design.designers).toEqual(['Morris, William', 'Webb, Philip Speakman']);
    expect(design.manufacturers).toContain('Jeffrey & Co.');
  });

  it('returns null for a design with no images', () => {
    expect(mapObjectResponse(loadFixture('object-no-images-O270961.json'))).toBeNull();
  });

  it('returns null when meta.images is null even if record.images lists ids', () => {
    const raw = structuredClone(loadFixture('museumobject-O78207.json')) as { meta: Record<string, unknown> };
    raw.meta.images = null;
    expect(mapObjectResponse(raw)).toBeNull();
  });

  it('returns null description, creditLine and collectionUrl when they are empty or absent', () => {
    const raw = structuredClone(loadFixture('museumobject-O78207.json')) as {
      meta: { _links: Record<string, unknown> };
      record: Record<string, unknown>;
    };
    raw.record.summaryDescription = '';
    raw.record.creditLine = '';
    raw.meta._links = {};
    const design = mapObjectResponse(raw)!;
    expect(design.description).toBeNull();
    expect(design.creditLine).toBeNull();
    expect(design.collectionUrl).toBeNull();
  });

  it('matches association spellings case-insensitively with a trailing s', () => {
    const raw = structuredClone(loadFixture('museumobject-O78207.json')) as {
      record: { artistMakerPerson: unknown[]; artistMakerOrganisations: unknown[] };
    };
    raw.record.artistMakerPerson = [
      { name: { text: 'A Person', id: 'A1' }, association: { text: 'Designers', id: 'x' }, note: '' },
    ];
    raw.record.artistMakerOrganisations = [
      { name: { text: 'An Org', id: 'A2' }, association: { text: 'MANUFACTURERS', id: 'x' }, note: '' },
    ];
    const design = mapObjectResponse(raw)!;
    expect(design.designers).toEqual(['A Person']);
    expect(design.manufacturers).toEqual(['An Org']);
  });

  it('throws on garbage input', () => {
    expect(() => mapObjectResponse({ nope: 1 })).toThrow();
  });
});

describe('htmlToText', () => {
  it('returns an empty string for an empty string', () => {
    expect(htmlToText('')).toBe('');
  });

  it('turns a double <br> into a paragraph break', () => {
    expect(htmlToText('one<br><br>two')).toBe('one\n\ntwo');
  });

  it('strips <b> tags but keeps their text', () => {
    expect(htmlToText('<b>Object Type</b>')).toBe('Object Type');
  });

  it('decodes &amp; &lt; &#39; and &nbsp;', () => {
    expect(htmlToText('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(htmlToText('a &lt; b')).toBe('a < b');
    expect(htmlToText('it&#39;s')).toBe("it's");
    expect(htmlToText('a&nbsp;b').replace(/ /g, ' ')).toBe('a b');
  });

  it('drops script elements including their content', () => {
    expect(htmlToText('<script>alert(1)</script>x')).toBe('x');
  });

  it('drops style elements including their content', () => {
    expect(htmlToText('<style>p{color:red}</style>y')).toBe('y');
  });

  it('decodes only once so &amp;lt; becomes &lt;', () => {
    expect(htmlToText('&amp;lt;')).toBe('&lt;');
  });

  it('does not turn an encoded tag into a real one', () => {
    expect(htmlToText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
  });

  it('handles an unterminated tag without throwing and without leaking a "<" from a tag', () => {
    expect(() => htmlToText('hello <b')).not.toThrow();
    expect(htmlToText('hello <b')).not.toContain('<');
    expect(htmlToText('hello <script>alert(1)')).not.toContain('alert');
  });

  it('strips tags that carry attributes', () => {
    const out = htmlToText('<a href="javascript:alert(1)" onclick="x()">link</a>');
    expect(out).toBe('link');
  });

  it('leaves plain text unchanged', () => {
    expect(htmlToText('Just words.')).toBe('Just words.');
  });
});
