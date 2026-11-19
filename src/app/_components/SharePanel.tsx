'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
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

/** An async wrapper, so a missing clipboard API (an insecure context) is a rejection like a refused write. */
async function writeToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Copy link and Export PNG. The link is built from the state, not read from the address bar, so it is never stale. */
export function SharePanel({ systemNumber, encoded, source, waitingFor }: Props) {
  const [message, setMessage] = useState('');
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const reasonId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  // Worked out at render, so the field a user copies from by hand always matches the colours on screen.
  const link = clipboardFailed ? colourwayHref(window.location.href, encoded) : '';

  useEffect(() => {
    if (clipboardFailed) fieldRef.current?.focus();
  }, [clipboardFailed]);

  const copy = useCallback(() => {
    writeToClipboard(colourwayHref(window.location.href, encoded)).then(
      () => {
        setClipboardFailed(false);
        setMessage('Link copied');
      },
      () => {
        // No clipboard access (permissions, an insecure context): show the link to copy by hand, and say so.
        setClipboardFailed(true);
        setMessage('We couldn’t copy the link. It is shown below to copy by hand.');
      },
    );
  }, [encoded]);

  const save = useCallback(() => {
    if (source === null || exporting) return;
    setExporting(true);
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
      )
      .finally(() => {
        setExporting(false);
      });
  }, [source, systemNumber, exporting]);

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
      {clipboardFailed ? (
        <label className="mt-3 block text-sm">
          Link to this colourway
          <input
            ref={fieldRef}
            readOnly
            value={link}
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
