'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { MAX_QUERY_LENGTH } from '@/lib/api/query-limits';
import { DesignCard } from './DesignCard';
import { useDebouncedValue } from './useDebouncedValue';
import { useDesignSearch, type DesignSearch } from './useDesignSearch';

const DEBOUNCE_MS = 300;

function statusText(search: DesignSearch, q: string): string {
  if (search.loading) return 'Loading designs…';
  if (search.failed) return '';
  if (search.items.length === 0) return q ? `No designs found for “${q}”.` : 'No designs found.';
  return `Showing ${String(search.items.length)} of ${String(search.total)} designs`;
}

function Footer({ search }: { search: DesignSearch }) {
  if (search.moreFailed) {
    return (
      <p role="alert" className="mt-10 text-muted">
        We couldn’t load more designs.{' '}
        <button type="button" onClick={search.loadMore} className="underline">
          Try again
        </button>
      </p>
    );
  }
  if (!search.hasMore) return null;
  return (
    <div className="mt-12 text-center">
      <button
        type="button"
        onClick={search.loadMore}
        disabled={search.loadingMore}
        className="border border-foreground px-6 py-2.5 text-sm tracking-wide hover:bg-foreground hover:text-background disabled:opacity-60"
      >
        {search.loadingMore ? 'Loading…' : 'Load more designs'}
      </button>
    </div>
  );
}

export function Browse() {
  const initial = (useSearchParams().get('q') ?? '').slice(0, MAX_QUERY_LENGTH);
  const [input, setInput] = useState(initial);
  const [q, flush] = useDebouncedValue(input.trim(), DEBOUNCE_MS);
  const search = useDesignSearch(q);

  // Keep the query in the address bar so a search can be shared. replaceState: typing doesn't fill the history.
  useEffect(() => {
    window.history.replaceState(null, '', q ? `/?q=${encodeURIComponent(q)}` : '/');
  }, [q]);

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    flush();
  };

  return (
    <section aria-labelledby="browse-heading">
      <form role="search" onSubmit={onSubmit} className="max-w-xl">
        <label htmlFor="search" className="block text-sm text-muted">
          Search designs by name, pattern or designer
        </label>
        <input
          id="search"
          type="search"
          value={input}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(event) => {
            setInput(event.target.value);
          }}
          placeholder="Strawberry Thief, acanthus, Dearle…"
          autoComplete="off"
          className="mt-2 w-full border-b border-foreground bg-transparent py-2 text-lg placeholder:text-muted/70 focus:outline-none focus-visible:border-accent"
        />
      </form>

      <h2 id="browse-heading" className="sr-only">
        Designs
      </h2>
      <p role="status" className="mt-6 min-h-6 text-sm text-muted">
        {statusText(search, q)}
      </p>

      {search.failed ? (
        <p role="alert" className="mt-4 text-foreground">
          We couldn’t reach the V&amp;A collection just now.{' '}
          <button type="button" onClick={search.retry} className="underline">
            Try again
          </button>
        </p>
      ) : null}

      <ul className="mt-6 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {search.items.map((design) => (
          <DesignCard key={design.systemNumber} design={design} />
        ))}
      </ul>

      <Footer search={search} />
    </section>
  );
}
