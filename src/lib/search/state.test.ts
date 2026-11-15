import { describe, expect, it } from 'vitest';
import { MAX_PAGE } from '../api/query-limits';
import type { DesignSummary, SearchResult } from '../vam/types';
import { appendPage, hasMorePages, mergeItems } from './state';

const item = (systemNumber: string): DesignSummary => ({
  systemNumber,
  title: systemNumber,
  designer: null,
  date: null,
  objectType: 'Wallpaper',
  imageBaseUrl: 'https://framemark.vam.ac.uk/collections/X1/',
});

describe('mergeItems', () => {
  it('appends new items in order', () => {
    expect(mergeItems([item('O1')], [item('O2'), item('O3')]).map((i) => i.systemNumber)).toEqual(['O1', 'O2', 'O3']);
  });

  it('drops items already shown (overlap between pages)', () => {
    expect(mergeItems([item('O1'), item('O2')], [item('O2'), item('O3')]).map((i) => i.systemNumber)).toEqual([
      'O1',
      'O2',
      'O3',
    ]);
  });

  it('drops a repeat inside the incoming page, so React keys stay unique', () => {
    expect(mergeItems([], [item('O1'), item('O1')])).toHaveLength(1);
  });

  it('keeps the first copy and does not mutate its inputs', () => {
    const existing = [item('O1')];
    mergeItems(existing, [item('O2')]);
    expect(existing).toHaveLength(1);
  });
});

describe('appendPage', () => {
  it('takes page and counters from the new page and merges the items', () => {
    const previous: SearchResult = { items: [item('O1')], page: 1, totalPages: 3, total: 70 };
    const next: SearchResult = { items: [item('O1'), item('O2')], page: 2, totalPages: 3, total: 71 };
    expect(appendPage(previous, next)).toEqual({
      items: [item('O1'), item('O2')],
      page: 2,
      totalPages: 3,
      total: 71,
    });
  });
});

describe('hasMorePages', () => {
  it('is true only while the current page is before the last', () => {
    expect(hasMorePages({ page: 1, totalPages: 2 })).toBe(true);
    expect(hasMorePages({ page: 2, totalPages: 2 })).toBe(false);
    expect(hasMorePages({ page: 100, totalPages: 0 })).toBe(false);
  });

  it('is false at MAX_PAGE even if the V&A reports more pages, because the server would reject page MAX_PAGE + 1', () => {
    expect(hasMorePages({ page: MAX_PAGE - 1, totalPages: MAX_PAGE + 10 })).toBe(true);
    expect(hasMorePages({ page: MAX_PAGE, totalPages: MAX_PAGE + 10 })).toBe(false);
  });
});
