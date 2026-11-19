'use client';

import { useEffect, useRef, useState } from 'react';
import { WHOLE, type Region } from '@/lib/wall/region';
import { DEFAULT_REPEATS, MAX_REPEATS, MIN_REPEATS, type Repeat } from '@/lib/wall/tiles';
import type { ExportSource } from './exportPng';
import { RegionPicker } from './RegionPicker';
import { paintSource, paintWall, WALL_H, WALL_W } from './wallDraw';

type Props = {
  /** What to tile: the live recoloured frame, or the untouched image. Null until there is a picture. */
  source: ExportSource | null;
  title: string;
  /** True when `source` is the recoloured picture, for the wall's text alternative. */
  recoloured: boolean;
};

const REPEAT_LABELS: [Repeat, string][] = [
  ['straight', 'Straight'],
  ['half-drop', 'Half-drop'],
];

/** The design tiled on a wall: a section with the repeat region, the repeat type and how many repeats fit across. */
export function WallPreview({ source, title, recoloured }: Props) {
  const [region, setRegion] = useState<Region>(WHOLE);
  const [repeat, setRepeat] = useState<Repeat>('straight');
  const [repeats, setRepeats] = useState(DEFAULT_REPEATS);
  const wallRef = useRef<HTMLCanvasElement>(null);
  const fullRef = useRef<HTMLCanvasElement | null>(null);

  // Two effects, in this order: the whole picture is drawn only when it changes; dragging the region or the sliders
  // then just re-tiles from that copy.
  useEffect(() => {
    if (source === null) return;
    fullRef.current ??= document.createElement('canvas');
    paintSource(fullRef.current, source);
  }, [source]);

  useEffect(() => {
    if (source !== null && wallRef.current && fullRef.current) {
      paintWall(wallRef.current, fullRef.current, region, repeats, repeat);
    }
  }, [source, region, repeats, repeat]);

  const label = `${title}${recoloured ? ', recoloured' : ''}, as a ${repeat} repeat on a wall`;
  return (
    <section aria-labelledby="wall-heading" className="mt-10">
      <h2 id="wall-heading" className="font-serif text-2xl">
        See it on a wall
      </h2>
      {source === null ? (
        <p role="status" className="mt-2 text-sm text-muted">
          The wall preview is available once the design image has loaded.
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-hidden border border-rule">
            <canvas
              ref={wallRef}
              width={WALL_W}
              height={WALL_H}
              role="img"
              aria-label={label}
              className="block h-auto w-full"
            />
            <div aria-hidden="true" className="h-3 border-y border-rule bg-mat" />
            <div aria-hidden="true" className="h-10 bg-foreground/15" />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
            <fieldset>
              <legend className="text-sm">Repeat</legend>
              <div className="mt-1 flex gap-4">
                {REPEAT_LABELS.map(([value, text]) => (
                  <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="wall-repeat"
                      value={value}
                      checked={repeat === value}
                      onChange={() => {
                        setRepeat(value);
                      }}
                    />
                    {text}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">
              Repeats across the wall: {repeats}
              <input
                type="range"
                min={MIN_REPEATS}
                max={MAX_REPEATS}
                step={1}
                value={repeats}
                onChange={(event) => {
                  setRepeats(event.target.valueAsNumber);
                }}
                className="mt-1 block min-h-11 w-48"
              />
            </label>
          </div>
          <RegionPicker source={source} region={region} onChange={setRegion} />
        </>
      )}
    </section>
  );
}
