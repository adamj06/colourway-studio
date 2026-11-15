import { MAX_PAGE } from '../api/query-limits';
import type { DesignSummary, SearchResult } from '../vam/types';

/** Appends a page of results to what is already shown, dropping repeats (across pages and within one page). */
export function mergeItems(existing: DesignSummary[], more: DesignSummary[]): DesignSummary[] {
  const seen = new Set<string>();
  return [...existing, ...more].filter((item) => {
    if (seen.has(item.systemNumber)) return false;
    seen.add(item.systemNumber);
    return true;
  });
}

/** The state after "load more": the new page's counters, with its items appended to the previous ones. */
export function appendPage(previous: SearchResult, next: SearchResult): SearchResult {
  return { ...next, items: mergeItems(previous.items, next.items) };
}

/** False at MAX_PAGE even if the V&A has more: the server rejects pages beyond it, so "Load more" would 400. */
export const hasMorePages = (result: Pick<SearchResult, 'page' | 'totalPages'>): boolean =>
  result.page < Math.min(result.totalPages, MAX_PAGE);
