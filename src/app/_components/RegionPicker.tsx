'use client';

import { useEffect, useRef, useState } from 'react';
import {
  fromPercent,
  regionFromPoints,
  toPercent,
  WHOLE,
  type Percent,
  type Point,
  type Region,
} from '@/lib/wall/region';
import type { ExportSource } from './exportPng';
import { paintSource } from './wallDraw';

type Props = { source: ExportSource; region: Region; onChange: (region: Region) => void };

const FIELDS: [keyof Percent, string][] = [
  ['left', 'Left'],
  ['top', 'Top'],
  ['width', 'Width'],
  ['height', 'Height'],
];

/**
 * One number box. It keeps what is being typed until the box loses focus: clamping on every keystroke would turn
 * typing "12" into a fight with the 5% minimum.
 */
function PercentField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block text-sm">
      {label} (%)
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={draft ?? String(value)}
        onChange={(event) => {
          setDraft(event.target.value);
          if (Number.isFinite(event.target.valueAsNumber)) onCommit(event.target.valueAsNumber);
        }}
        onBlur={() => {
          setDraft(null);
        }}
        className="mt-1 block min-h-11 w-full border border-rule bg-transparent px-2"
      />
    </label>
  );
}

/** Where a pointer is on the picture, as fractions of it, or null if the picture has no size to measure. */
function pointOf(event: React.PointerEvent<HTMLElement>): Point | null {
  const box = event.currentTarget.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
}

/** The design with a rectangle on it. Drag to mark one repeat, or type the numbers: the two stay in step. */
export function RegionPicker({ source, region, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragFrom = useRef<Point | null>(null);
  const percent = toPercent(region);

  useEffect(() => {
    if (canvasRef.current) paintSource(canvasRef.current, source);
  }, [source]);

  const drag = (event: React.PointerEvent<HTMLElement>) => {
    const to = pointOf(event);
    if (dragFrom.current !== null && to !== null) onChange(regionFromPoints(dragFrom.current, to));
  };
  const end = () => {
    dragFrom.current = null;
  };

  return (
    <fieldset className="mt-4">
      <legend className="text-sm">Repeat region</legend>
      <p className="mt-1 text-sm text-muted">
        Drag on the picture to mark one repeat of the pattern, or type the numbers below.
      </p>
      <div
        className="relative mt-3 w-fit max-w-full touch-none select-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragFrom.current = pointOf(event);
        }}
        onPointerMove={drag}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="block max-h-64 max-w-full cursor-crosshair" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute border-2 border-accent bg-accent/10"
          style={{
            left: `${String(percent.left)}%`,
            top: `${String(percent.top)}%`,
            width: `${String(percent.width)}%`,
            height: `${String(percent.height)}%`,
          }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FIELDS.map(([field, label]) => (
          <PercentField
            key={field}
            label={label}
            value={percent[field]}
            onCommit={(value) => {
              onChange(fromPercent({ ...percent, [field]: value }));
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onChange(WHOLE);
        }}
        className="mt-3 min-h-11 border border-foreground px-3 text-sm"
      >
        Use whole image
      </button>
    </fieldset>
  );
}
