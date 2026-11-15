'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Swatch } from '@/lib/colour/types';
import { createPaletteClient, type PaletteClient, type PaletteRequest } from './paletteClient';

export const DEFAULT_K = 6;

export type PaletteStatus = 'waiting' | 'loading' | 'ready' | 'error';

export type PaletteView = {
  status: PaletteStatus;
  swatches: Swatch[];
  k: number;
  setK: (k: number) => void;
  retry: () => void;
  /** Call from the image's onLoad: the worker starts once the image has decoded. */
  onImage: (img: HTMLImageElement) => void;
};

type Outcome = { tag: string; swatches: Swatch[] | null };

/**
 * Palette state for one design image. The worker is created lazily (only on the design page, only after the image
 * has loaded) and terminated on unmount. The answer is matched to the current k and attempt by tag, so a late
 * answer for an older k can never be shown.
 */
export function usePalette(): PaletteView {
  const [k, setK] = useState(DEFAULT_K);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const clientRef = useRef<PaletteClient | null>(null);
  const tag = `${String(attempt)}:${String(k)}`;
  const latest = useRef<PaletteRequest>({ k, tag });

  useEffect(() => {
    latest.current = { k, tag };
    clientRef.current?.request(latest.current);
  }, [k, tag]);

  useEffect(() => {
    if (image === null) return;
    const client = createPaletteClient(image, latest.current, (answeredTag, swatches) => {
      setOutcome({ tag: answeredTag, swatches });
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [image, attempt]);

  const onImage = useCallback((img: HTMLImageElement) => {
    if (img.naturalWidth > 0) setImage(img);
  }, []);
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const answered = outcome?.tag === tag ? outcome.swatches : undefined;
  let status: PaletteStatus = image === null ? 'waiting' : 'loading';
  if (answered === null) status = 'error';
  else if (answered !== undefined) status = 'ready';
  return { status, swatches: answered ?? [], k, setK, retry, onImage };
}
