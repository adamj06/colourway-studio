'use client';

import { useCallback, useEffect, useState } from 'react';
import { isSearchResult } from '@/lib/vam/guards';
import type { DesignSummary, SearchResult } from '@/lib/vam/types';

type Loaded = SearchResult & { key: string; failed: boolean };

export type DesignSearch = {
  items: DesignSummary[];
  total: number;
  hasMore: boolean;
  /** First page of a new query is loading. */
  loading: boolean;
  /** The first page failed. */
  failed: boolean;
  loadingMore: boolean;
  /** A "load more" request failed. */
  moreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
};

async function fetchPage(q: string, page: number, signal?: AbortSignal): Promise<SearchResult> {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set('q', q);
  const response = await fetch(`/api/vam/search?${params.toString()}`, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Search failed with ${String(response.status)}`);
  const json: unknown = await response.json();
  if (!isSearchResult(json)) throw new Error('Unexpected search response');
  return json;
}

function mergeItems(existing: DesignSummary[], more: DesignSummary[]): DesignSummary[] {
  const seen = new Set(existing.map((item) => item.systemNumber));
  return [...existing, ...more.filter((item) => !seen.has(item.systemNumber))];
}

/** Search state for the home page. `q` must already be debounced: this fires one request per distinct q. */
export function useDesignSearch(q: string): DesignSearch {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const key = `${q}\u0000${String(attempt)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchPage(q, 1, controller.signal).then(
      (result) => {
        setLoaded({ ...result, key, failed: false });
        setMoreFailed(false);
      },
      () => {
        if (!controller.signal.aborted) {
          setLoaded({ items: [], page: 1, totalPages: 0, total: 0, key, failed: true });
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [q, key]);

  const current = loaded?.key === key ? loaded : null;

  const loadMore = useCallback(() => {
    if (!current || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    fetchPage(q, current.page + 1).then(
      (result) => {
        // Ignore the answer if the query changed while it was in flight.
        setLoaded((prev) =>
          prev?.key === key ? { ...prev, ...result, items: mergeItems(prev.items, result.items) } : prev,
        );
        setLoadingMore(false);
      },
      () => {
        setMoreFailed(true);
        setLoadingMore(false);
      },
    );
  }, [current, loadingMore, q, key]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return {
    items: current?.items ?? [],
    total: current?.total ?? 0,
    hasMore: current ? current.page < current.totalPages : false,
    loading: current === null,
    failed: current?.failed ?? false,
    loadingMore,
    moreFailed,
    loadMore,
    retry,
  };
}
