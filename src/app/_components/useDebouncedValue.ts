'use client';

import { useCallback, useEffect, useState } from 'react';

/** `value` after it has stopped changing for `ms`. `flush` applies the latest value immediately (e.g. on Enter). */
export function useDebouncedValue(value: string, ms: number): [debounced: string, flush: () => void] {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);

  const flush = useCallback(() => {
    setDebounced(value);
  }, [value]);

  return [debounced, flush];
}
