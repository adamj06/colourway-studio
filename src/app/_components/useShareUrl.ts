'use client';

import { useEffect } from 'react';
import { colourwayHref } from '@/lib/colourway/url';
import { SETTLE_MS } from './recolourClient';

/**
 * Keeps the address bar's `cw` parameter in step with the colourway: set while there are edits, removed when there
 * are none. It waits for the same pause as the full-quality frame (SETTLE_MS), so dragging a colour picker does not
 * rewrite the URL on every input event, and it replaces the history entry instead of adding one, so Back still
 * leaves the page. A link that is already right is left alone.
 */
export function useShareUrl(encoded: string | null): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = colourwayHref(window.location.href, encoded);
      if (next === window.location.href) return;
      window.history.replaceState(window.history.state, '', next);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [encoded]);
}
