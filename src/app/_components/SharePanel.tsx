'use client';

import { useCallback, useId, useState } from 'react';
import { colourwayHref } from '@/lib/colourway/url';
import type { ExportSource } from './exportPng';

type Props = {
  systemNumber: string;
  /** The colourway as the `cw` value, or null when nothing has been changed. */
  encoded: string | null;
  /** What Export PNG would save right now, or null when it cannot yet (the reason is `waitingFor`). */
  source: ExportSource | null;
  /** Why export is unavailable, said to assistive technology while the button is disabled. */
  waitingFor: string;
};

const button = 'min-h-11 border border-foreground px-3 text-sm disabled:border-rule disabled:text-muted';

/** Copy link and Export PNG. The link is built from the state, not read from the address bar, so it is never stale. */
export function SharePanel({ systemNumber, encoded, source, waitingFor }: Props) {
  const [message, setMessage] = useState('');
  const [manualLink, setManualLink] = useState<string | null>(null);
  const reasonId = useId();

  const copy = useCallback(() => {
    const link = colourwayHref(window.location.href, encoded);
    setMessage('');
    navigator.clipboard.writeText(link).then(
      () => {
        setManualLink(null);
        setMessage('Link copied');
      },
      () => {
        // No clipboard access (permissions, an insecure context): show the link to copy by hand.
        setManualLink(link);
      },
    );
  }, [encoded]);

  const save = useCallback(() => {
    if (source === null) return;
    setMessage('');
    import('./exportPng')
      .then(({ exportPng }) => exportPng(source, systemNumber))
      .then(
        () => {
          setMessage('Image exported');
        },
        () => {
          setMessage('We couldn’t export the image. Please try again.');
        },
      );
  }, [source, systemNumber]);

  return (
    <section aria-label="Share and export" className="mt-8">
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={copy} className={button}>
          Copy link
        </button>
        <button
          type="button"
          onClick={save}
          disabled={source === null}
          aria-describedby={source === null ? reasonId : undefined}
          className={button}
        >
          Export PNG
        </button>
      </div>
      {source === null ? (
        <p id={reasonId} className="mt-2 text-sm text-muted">
          {waitingFor}
        </p>
      ) : null}
      {manualLink !== null ? (
        <label className="mt-3 block text-sm">
          Link to this colourway
          <input
            readOnly
            value={manualLink}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="mt-1 block w-full border border-rule bg-transparent p-2"
          />
        </label>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 min-h-6 text-sm text-muted">
        {message}
      </p>
    </section>
  );
}
