'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lab, Swatch } from '@/lib/colour/types';
import {
  createRecolourClient,
  labOfHex,
  type Frame,
  type RecolourClient,
  type RecolourRequest,
} from './recolourClient';

export type RecolourView = {
  /** The newest recoloured picture for the current palette, or null (nothing to show yet, or it failed). */
  frame: Frame | null;
  /** True when `frame` is the full-quality answer for the targets as they are now (not a preview, not out of date). */
  settled: boolean;
  failed: boolean;
  retry: () => void;
};

type Args = {
  image: HTMLImageElement | null;
  swatches: Swatch[];
  /** One hex per swatch: the colour each should have now. */
  targets: string[];
  /** False when nothing has been changed: no worker is created at all. */
  active: boolean;
};

type Outcome = { tag: string; frame: Frame | null; final: boolean };

const labsOf = (hexes: string): Lab[] => (hexes === '' ? [] : hexes.split(',').map(labOfHex));

/** The frame is the full-quality answer for exactly the targets asked for now. */
export const isSettled = (outcome: Outcome | null, tag: string): boolean =>
  outcome !== null && outcome.frame !== null && outcome.final && outcome.tag === tag;

/**
 * Recoloured frames for one design image. The worker is created lazily, only once a colour has been changed, and
 * terminated when the edits are gone. The newest frame stays on screen while a newer one is being made, so dragging a
 * picker never flashes the original. A frame for an older palette is never shown (the epoch is part of every tag).
 */
export function useRecolour({ image, swatches, targets, active }: Args): RecolourView {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const clientRef = useRef<RecolourClient | null>(null);
  const sourcesKey = swatches.map((swatch) => swatch.hex).join(',');
  const targetsKey = targets.join(',');
  const epoch = `${String(attempt)}:${sourcesKey}`;
  const tag = `${epoch}|${targetsKey}`;
  const latest = useRef<RecolourRequest>({ targets: [], tag });

  useEffect(() => {
    latest.current = { targets: labsOf(targetsKey), tag };
    clientRef.current?.request(latest.current);
  }, [targetsKey, tag]);

  useEffect(() => {
    if (!active || image === null) return;
    const client = createRecolourClient(image, labsOf(sourcesKey), latest.current, (answeredTag, frame, final) => {
      setOutcome({ tag: answeredTag, frame, final });
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
      // A frame from this client must not be shown by the next one (after Reset all and a new edit, say).
      setOutcome(null);
    };
  }, [active, image, sourcesKey, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const current = active && outcome?.tag.startsWith(`${epoch}|`) === true ? outcome : null;
  return {
    frame: current?.frame ?? null,
    settled: isSettled(current, tag),
    failed: current?.frame === null && current.tag === tag,
    retry,
  };
}
