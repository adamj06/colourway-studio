'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { appendPage, hasMorePages } from '@/lib/search/state';
import { isSearchResult } from '@/lib/vam/guards';
import type { DesignSummary, SearchResult } from '@/lib/vam/types';

type Loaded = SearchResult & { key: string; failed: boolean };
type More = { key: string; status: 'idle' | 'loading' | 'failed' };

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

async function fetchPage(q: string, page: number, signal: AbortSignal): Promise<SearchResult> {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set('q', q);
  const response = await fetch(`/api/vam/search?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Search failed with ${String(response.status)}`);
  const json: unknown = await response.json();
  if (!isSearchResult(json)) throw new Error('Unexpected search response');
  return json;
}

/** Search state for the home page. `q` must already be debounced: this fires one request per distinct q. */
export function useDesignSearch(q: string): DesignSearch {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [more, setMore] = useState<More>({ key: '', status: 'idle' });
  const moreController = useRef<AbortController | null>(null);
  // Everything below is tied to this key, so an answer for an old query can never touch the current one.
  const key = `${q}\u0000${String(attempt)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchPage(q, 1, controller.signal).then(
      (result) => {
        setLoaded({ ...result, key, failed: false });
      },
      () => {
        if (!controller.signal.aborted) {
          setLoaded({ items: [], page: 1, totalPages: 0, total: 0, key, failed: true });
        }
      },
    );
    return () => {
      controller.abort();
      moreController.current?.abort();
      // An aborted load-more never settles, so clear its state: otherwise coming back to this same query later
      // would show a stuck, disabled "Loading…" button.
      setMore((previous) => (previous.key === key ? { key, status: 'idle' } : previous));
    };
  }, [q, key]);

  const current = loaded?.key === key ? loaded : null;
  const moreStatus = more.key === key ? more.status : 'idle';

  const loadMore = useCallback(() => {
    if (!current || moreStatus === 'loading') return;
    const controller = new AbortController();
    moreController.current = controller;
    setMore({ key, status: 'loading' });
    fetchPage(q, current.page + 1, controller.signal).then(
      (result) => {
        setLoaded((prev) => (prev?.key === key ? { ...prev, ...appendPage(prev, result) } : prev));
        setMore({ key, status: 'idle' });
      },
      () => {
        if (!controller.signal.aborted) setMore({ key, status: 'failed' });
      },
    );
  }, [current, moreStatus, q, key]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { ...describe(current, moreStatus), loadMore, retry };
}

function describe(current: Loaded | null, moreStatus: More['status']) {
  return {
    items: current?.items ?? [],
    total: current?.total ?? 0,
    hasMore: current ? hasMorePages(current) : false,
    loading: current === null,
    failed: current?.failed ?? false,
    loadingMore: moreStatus === 'loading',
    moreFailed: moreStatus === 'failed',
  };
}
