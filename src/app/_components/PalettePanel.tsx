'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Swatch } from '@/lib/colour/types';
import {
  changedMessage,
  CLEARED_MESSAGE,
  coloursCount,
  fewerColoursMessage,
  formatShare,
  RESET_ALL_MESSAGE,
  resetMessage,
  swatchPickerLabel,
} from './paletteFormat';
import type { ColourwayView } from './useColourway';
import type { PaletteView } from './usePalette';

const K_OPTIONS = [4, 5, 6, 7, 8] as const;

function KControl(props: {
  k: number;
  disabled: boolean;
  describedBy?: string | undefined;
  onChange: (k: number) => void;
}) {
  const { k, disabled, describedBy, onChange } = props;
  return (
    <fieldset className="mt-4 disabled:opacity-50" disabled={disabled} aria-describedby={describedBy}>
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

type ColourInputProps = {
  id: string;
  label: string;
  value: string;
  onLive: (hex: string) => void;
  onSettle: (hex: string) => void;
};

/**
 * The native colour picker. React's onChange fires on every `input` event (live preview while dragging); the native
 * `change` event fires once the user settles on a colour, which is when the screen reader is told.
 */
function ColourInput({ id, label, value, onLive, onSettle }: ColourInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (input === null) return;
    const settle = () => {
      onSettle(input.value.toUpperCase());
    };
    input.addEventListener('change', settle);
    return () => {
      input.removeEventListener('change', settle);
    };
  }, [onSettle]);
  return (
    <input
      ref={ref}
      id={id}
      type="color"
      aria-label={label}
      value={value.toLowerCase()}
      onChange={(event) => {
        onLive(event.target.value.toUpperCase());
      }}
      className="block h-14 w-full cursor-pointer border border-rule bg-transparent p-0"
    />
  );
}

type ItemProps = {
  swatch: Swatch;
  index: number;
  total: number;
  hex: string;
  original: string;
  onLive: (index: number, hex: string) => void;
  onSettle: (index: number, hex: string) => void;
  onReset: (index: number) => void;
  onCopy: (hex: string) => void;
};

function SwatchItem({ swatch, index, total, hex, original, onLive, onSettle, onReset, onCopy }: ItemProps) {
  const edited = hex !== original;
  const live = useCallback(
    (next: string) => {
      onLive(index, next);
    },
    [onLive, index],
  );
  const settle = useCallback(
    (next: string) => {
      onSettle(index, next);
    },
    [onSettle, index],
  );
  const button = 'min-h-11 border border-rule px-3 text-sm hover:border-foreground';
  return (
    <li className="border border-rule p-2">
      <ColourInput
        id={`swatch-input-${String(index)}`}
        label={swatchPickerLabel(index, total, hex, swatch.share)}
        value={hex}
        onLive={live}
        onSettle={settle}
      />
      <p aria-hidden="true" className="mt-1 font-mono text-sm">
        {hex}
      </p>
      <p aria-hidden="true" className="text-xs text-muted">
        {formatShare(swatch.share)} of the design
      </p>
      {edited ? (
        <p className="mt-1 flex items-center gap-2 text-xs text-muted">
          <span
            aria-hidden="true"
            className="inline-block size-3 border border-rule"
            style={{ background: original }}
          />
          Original {original}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={`Copy ${hex}`}
          className={button}
          onClick={() => {
            onCopy(hex);
          }}
        >
          Copy
        </button>
        {edited ? (
          <button
            type="button"
            aria-label={`Reset colour ${String(index + 1)}`}
            className={button}
            onClick={() => {
              onReset(index);
            }}
          >
            Reset
          </button>
        ) : null}
      </div>
    </li>
  );
}

function message(palette: PaletteView, note: string | null): string {
  if (note !== null) return note;
  if (palette.status === 'ready') return `Palette ready: ${coloursCount(palette.swatches.length)}`;
  if (palette.status === 'loading') return 'Extracting palette…';
  if (palette.status === 'unavailable') return 'The image couldn’t be loaded, so there is no palette.';
  return '';
}

const focusSwatch = (index: number) => {
  document.getElementById(`swatch-input-${String(index)}`)?.focus();
};

export function PalettePanel({ palette, colourway }: { palette: PaletteView; colourway: ColourwayView }) {
  // One live message at a time: the last thing the user did (a copy, a colour change, a reset).
  const [note, setNote] = useState<string | null>(null);
  const { setK, retry } = palette;
  const { set, reset, resetAll, hasEdits } = colourway;

  const copy = useCallback((hex: string) => {
    // Undefined on insecure origins (plain http on a LAN, some embedded webviews).
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      setNote(`Couldn’t copy ${hex}`);
      return;
    }
    clipboard.writeText(hex).then(
      () => {
        setNote(`Copied ${hex}`);
      },
      () => {
        setNote(`Couldn’t copy ${hex}`);
      },
    );
  }, []);
  const changeK = useCallback(
    (k: number) => {
      setNote(hasEdits ? CLEARED_MESSAGE : null);
      setK(k);
    },
    [setK, hasEdits],
  );
  const settle = useCallback((index: number, hex: string) => {
    setNote(changedMessage(index, hex));
  }, []);
  const resetOne = useCallback(
    (index: number) => {
      reset(index);
      setNote(resetMessage(index));
      // The Reset button unmounts: keep keyboard focus on the swatch it belonged to.
      focusSwatch(index);
    },
    [reset],
  );
  const resetEverything = useCallback(() => {
    resetAll();
    setNote(RESET_ALL_MESSAGE);
    document.getElementById('palette-heading')?.focus();
  }, [resetAll]);
  const tryAgain = useCallback(() => {
    retry();
    // The button unmounts when the retry starts; keep keyboard focus on the panel instead of dropping to <body>.
    document.getElementById('palette-heading')?.focus();
  }, [retry]);

  // A palette from a share link was never extracted, so "fewer than k" says nothing about the design.
  const showFewer =
    palette.status === 'ready' && !palette.linked && palette.swatches.length > 0 && palette.swatches.length < palette.k;

  return (
    <section aria-labelledby="palette-heading" className="mt-8">
      <h2 id="palette-heading" tabIndex={-1} className="font-serif text-2xl">
        Palette
      </h2>
      <KControl
        k={palette.k}
        disabled={palette.status === 'waiting' || palette.status === 'unavailable'}
        describedBy={showFewer ? 'palette-fewer-note' : undefined}
        onChange={changeK}
      />
      <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm text-muted">
        {message(palette, note)}
      </p>
      {showFewer ? (
        <p id="palette-fewer-note" className="mt-2 text-sm text-muted">
          {fewerColoursMessage(palette.swatches.length)}
        </p>
      ) : null}
      {palette.status === 'error' ? (
        <p role="alert" className="mt-2">
          We couldn’t read the colours from this image.{' '}
          <button type="button" onClick={tryAgain} className="underline">
            Try again
          </button>
        </p>
      ) : null}
      {palette.swatches.length > 0 ? (
        <p className="mt-2 text-sm text-muted">Select a swatch to change its colour in the design.</p>
      ) : null}
      {hasEdits ? (
        <button type="button" onClick={resetEverything} className="mt-2 min-h-11 border border-rule px-3 text-sm">
          Reset all colours
        </button>
      ) : null}
      <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy={palette.status === 'loading'}>
        {palette.swatches.map((swatch, index) => (
          <SwatchItem
            key={`${String(index)}:${swatch.hex}`}
            swatch={swatch}
            index={index}
            total={palette.swatches.length}
            hex={colourway.targets[index] ?? swatch.hex}
            original={swatch.hex}
            onLive={set}
            onSettle={settle}
            onReset={resetOne}
            onCopy={copy}
          />
        ))}
      </ul>
    </section>
  );
}
