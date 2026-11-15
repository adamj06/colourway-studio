'use client';

import { useCallback, useState } from 'react';
import type { Swatch } from '@/lib/colour/types';
import { coloursCount, formatShare, swatchLabel } from './paletteFormat';
import type { PaletteView } from './usePalette';

const K_OPTIONS = [4, 5, 6, 7, 8] as const;

type Copied = { hex: string; ok: boolean };

function KControl({ k, onChange }: { k: number; onChange: (k: number) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm text-muted">Number of colours</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {K_OPTIONS.map((option) => (
          <label
            key={option}
            className="flex min-w-11 cursor-pointer items-center justify-center border border-foreground px-3 py-2 text-sm has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          >
            <input
              type="radio"
              name="palette-k"
              value={option}
              checked={k === option}
              onChange={() => {
                onChange(option);
              }}
              className="sr-only"
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SwatchButton(props: { swatch: Swatch; index: number; total: number; onCopy: (hex: string) => void }) {
  const { swatch, index, total, onCopy } = props;
  return (
    <button
      type="button"
      aria-label={swatchLabel(index, total, swatch.hex, swatch.share)}
      onClick={() => {
        onCopy(swatch.hex);
      }}
      className="flex w-full flex-col gap-2 border border-rule p-2 text-left hover:border-foreground"
    >
      <span aria-hidden="true" className="block h-14 w-full border border-rule" style={{ background: swatch.hex }} />
      <span aria-hidden="true" className="font-mono text-sm">
        {swatch.hex}
      </span>
      <span aria-hidden="true" className="text-xs text-muted">
        {formatShare(swatch.share)} · Copy
      </span>
    </button>
  );
}

function message(palette: PaletteView, copied: Copied | null): string {
  if (copied) return copied.ok ? `Copied ${copied.hex}` : `Couldn’t copy ${copied.hex}`;
  if (palette.status === 'ready') return `Palette ready: ${coloursCount(palette.swatches.length)}`;
  if (palette.status === 'loading') return 'Extracting palette…';
  return '';
}

export function PalettePanel({ palette }: { palette: PaletteView }) {
  const [copied, setCopied] = useState<Copied | null>(null);
  const { setK, retry } = palette;

  const copy = useCallback((hex: string) => {
    navigator.clipboard.writeText(hex).then(
      () => {
        setCopied({ hex, ok: true });
      },
      () => {
        setCopied({ hex, ok: false });
      },
    );
  }, []);
  const changeK = useCallback(
    (k: number) => {
      setCopied(null);
      setK(k);
    },
    [setK],
  );

  return (
    <section aria-labelledby="palette-heading" className="mt-8">
      <h2 id="palette-heading" className="font-serif text-2xl">
        Palette
      </h2>
      <KControl k={palette.k} onChange={changeK} />
      <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm text-muted">
        {message(palette, copied)}
      </p>
      {palette.status === 'error' ? (
        <p role="alert" className="mt-2">
          We couldn’t read the colours from this image.{' '}
          <button type="button" onClick={retry} className="underline">
            Try again
          </button>
        </p>
      ) : null}
      <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy={palette.status === 'loading'}>
        {palette.swatches.map((swatch, index) => (
          <li key={swatch.hex}>
            <SwatchButton swatch={swatch} index={index} total={palette.swatches.length} onCopy={copy} />
          </li>
        ))}
      </ul>
    </section>
  );
}
