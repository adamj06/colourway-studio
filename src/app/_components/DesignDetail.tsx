'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { isDesign } from '@/lib/vam/guards';
import type { Design } from '@/lib/vam/types';
import { DesignImage } from './DesignImage';
import { PalettePanel } from './PalettePanel';
import { usePalette } from './usePalette';

type Result = { key: string; outcome: { design: Design } | { error: 'not_found' | 'failed' } };

async function fetchDesign(systemNumber: string, signal: AbortSignal): Promise<Result['outcome']> {
  const response = await fetch(`/api/vam/object/${encodeURIComponent(systemNumber)}`, { signal });
  if (response.status === 404) return { error: 'not_found' };
  if (!response.ok) return { error: 'failed' };
  const json: unknown = await response.json();
  return isDesign(json) ? { design: json } : { error: 'failed' };
}

function BackLink() {
  return (
    <Link href="/" className="text-sm text-muted underline">
      ← All designs
    </Link>
  );
}

const list = (names: string[]) => names.join(', ');

function Facts({ design }: { design: Design }) {
  const rows: [string, string | null][] = [
    ['Designed by', design.designers.length > 0 ? list(design.designers) : null],
    ['Made by', design.manufacturers.length > 0 ? list(design.manufacturers) : null],
    ['Date', design.date],
    ['Type', design.objectType || null],
    ['Materials', design.materials],
    ['Dimensions', design.dimensions],
    ['Credit', design.creditLine],
  ];
  return (
    <dl className="mt-6 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) =>
        value ? (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

function Loaded({ design }: { design: Design }) {
  const palette = usePalette();
  return (
    <article>
      {/* React 19 hoists <title> into <head>: each design gets its own page title (WCAG 2.4.2). */}
      <title>{`${design.title} · Colourway Studio`}</title>
      <BackLink />
      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <div className="flex aspect-[4/3] max-h-[80vh] items-center justify-center bg-mat">
            <DesignImage
              imageBaseUrl={design.imageBaseUrl}
              size={1600}
              alt={`${design.title}${design.objectType ? `, ${design.objectType.toLowerCase()}` : ''}`}
              priority
              className="max-h-full max-w-full object-contain"
              onLoad={(event) => {
                palette.onImage(event.currentTarget);
              }}
              onError={palette.onImageError}
            />
          </div>
        </div>
        <div>
          <h1 className="font-serif text-4xl leading-tight">{design.title}</h1>
          <Facts design={design} />
          <PalettePanel palette={palette} />
          {design.description ? (
            <div className="mt-8 space-y-4 leading-relaxed whitespace-pre-line">
              {design.description.split('\n\n').map((paragraph, index) => (
                // Position in the key: a description can repeat a paragraph, and this list never reorders.
                <p key={`${String(index)}:${paragraph.slice(0, 24)}`}>{paragraph}</p>
              ))}
            </div>
          ) : null}
          {design.collectionUrl ? (
            <p className="mt-8 text-sm">
              <a href={design.collectionUrl} rel="noopener noreferrer" className="underline">
                View in the V&amp;A collection
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Problem({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div role="alert">
      <title>{`${title} · Colourway Studio`}</title>
      <BackLink />
      <h1 className="mt-6 font-serif text-3xl">{title}</h1>
      <div className="mt-3 text-muted">{children}</div>
    </div>
  );
}

export function DesignDetail({ systemNumber }: { systemNumber: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${systemNumber}:${String(attempt)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchDesign(systemNumber, controller.signal).then(
      (outcome) => {
        setResult({ key, outcome });
      },
      () => {
        if (!controller.signal.aborted) setResult({ key, outcome: { error: 'failed' } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [systemNumber, key]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const outcome = result?.key === key ? result.outcome : null;
  if (outcome === null) return <p role="status">Loading design…</p>;
  if ('design' in outcome) return <Loaded design={outcome.design} />;
  if (outcome.error === 'not_found') {
    return (
      <Problem title="We couldn’t find that design">
        <p>It may have been removed from the collection, or the link is wrong.</p>
      </Problem>
    );
  }
  return (
    <Problem title="We couldn’t load this design">
      <p>
        The V&amp;A collection isn’t responding just now.{' '}
        <button type="button" onClick={retry} className="underline">
          Try again
        </button>
      </p>
    </Problem>
  );
}
