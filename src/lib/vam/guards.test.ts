import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/helpers/fixtures';
import { isDesign, isSearchResult } from './guards';
import { mapObjectResponse, mapSearchResponse } from './map';

const searchResult = mapSearchResponse(loadFixture('search-morris-wallpaper.json'));
const design = mapObjectResponse(loadFixture('museumobject-O78207.json'))!;

describe('isSearchResult', () => {
  it('accepts a real mapped search result (and its JSON round trip)', () => {
    expect(isSearchResult(searchResult)).toBe(true);
    expect(isSearchResult(JSON.parse(JSON.stringify(searchResult)))).toBe(true);
  });

  it('accepts an empty page', () => {
    expect(isSearchResult({ items: [], page: 100, totalPages: 0, total: 769 })).toBe(true);
  });

  it.each([null, undefined, 'x', 7, [], {}, { items: 'no' }])('rejects %j', (value) => {
    expect(isSearchResult(value)).toBe(false);
  });

  it('rejects wrong or missing numbers', () => {
    expect(isSearchResult({ ...searchResult, page: '1' })).toBe(false);
    expect(isSearchResult({ ...searchResult, total: undefined })).toBe(false);
    expect(isSearchResult({ ...searchResult, totalPages: Number.NaN })).toBe(false);
  });

  it('rejects an item with a missing or non-string field', () => {
    expect(isSearchResult({ ...searchResult, items: [{ ...searchResult.items[0], title: 5 }] })).toBe(false);
    expect(isSearchResult({ ...searchResult, items: [{ ...searchResult.items[0], designer: undefined }] })).toBe(false);
    expect(isSearchResult({ ...searchResult, items: [null] })).toBe(false);
  });

  it('rejects an item whose image base url is not a framemark IIIF url', () => {
    const bad = { ...searchResult.items[0], imageBaseUrl: 'https://evil.example/collections/X/' };
    expect(isSearchResult({ ...searchResult, items: [bad] })).toBe(false);
  });

  it('accepts null designer and date', () => {
    const item = { ...searchResult.items[0], designer: null, date: null };
    expect(isSearchResult({ ...searchResult, items: [item] })).toBe(true);
  });
});

describe('isDesign', () => {
  it('accepts a real mapped design (and its JSON round trip)', () => {
    expect(isDesign(design)).toBe(true);
    expect(isDesign(JSON.parse(JSON.stringify(design)))).toBe(true);
  });

  it.each([null, undefined, 'x', 7, [], {}])('rejects %j', (value) => {
    expect(isDesign(value)).toBe(false);
  });

  it('rejects non-array designers or manufacturers and non-string entries', () => {
    expect(isDesign({ ...design, designers: 'Morris' })).toBe(false);
    expect(isDesign({ ...design, designers: [1] })).toBe(false);
    expect(isDesign({ ...design, manufacturers: null })).toBe(false);
  });

  it('rejects a wrong-typed nullable field but accepts null', () => {
    expect(isDesign({ ...design, materials: 3 })).toBe(false);
    expect(isDesign({ ...design, description: null, creditLine: null, collectionUrl: null, dimensions: null })).toBe(
      true,
    );
  });

  it('rejects an image base url that is not a framemark IIIF url', () => {
    expect(isDesign({ ...design, imageBaseUrl: 'http://framemark.vam.ac.uk/collections/X/' })).toBe(false);
  });

  it('rejects a collection url that is not https', () => {
    expect(isDesign({ ...design, collectionUrl: 'javascript:alert(1)' })).toBe(false);
  });
});
