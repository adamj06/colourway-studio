'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Swatch } from '@/lib/colour/types';
import { createPaletteClient, type KnownSwatch, type PaletteClient, type PaletteRequest } from './paletteClient';
import { labOfHex } from './recolourClient';

export const DEFAULT_K = 6;
const MIN_K = 4;
const MAX_K = 8;

export type PaletteStatus = 'waiting' | 'loading' | 'ready' | 'error' | 'unavailable';

export type PaletteView = {
  status: PaletteStatus;
  swatches: Swatch[];
  k: number;
  /** The decoded design image, once it has loaded (the recolour worker reads the same element). */
  image: HTMLImageElement | null;
  setK: (k: number) => void;
  retry: () => void;
  /** Call from the image's onLoad: the worker starts once the image has decoded. */
  onImage: (img: HTMLImageElement) => void;
  /** Call from the image's onError: there is nothing to analyse, so the panel says so instead of waiting forever. */
  onImageError: () => void;
};

type Outcome = { tag: string; swatches: Swatch[] | null };

/**
 * Palette state for one design image. The worker is created lazily (only on the design page, only after the image
 * has loaded) and terminated on unmount. The answer is matched to the current k and attempt by tag, so a late
 * answer for an older k can never be shown.
 */
export function usePalette(fromLink: readonly string[] | null = null): PaletteView {
  // A palette from a share link is used as it is (its shares are measured, nothing is extracted) until k is changed.
  const known = useRef<KnownSwatch[] | null>(
    fromLink === null ? null : fromLink.map((hex) => ({ hex, lab: labOfHex(hex) })),
  );
  const [k, setRequestedK] = useState(() =>
    fromLink === null ? DEFAULT_K : Math.min(MAX_K, Math.max(MIN_K, fromLink.length)),
  );
  const setK = useCallback((next: number) => {
    known.current = null;
    setRequestedK(next);
  }, []);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const clientRef = useRef<PaletteClient | null>(null);
  const tag = `${String(attempt)}:${String(k)}`;
  const latest = useRef<PaletteRequest>({ k, tag });

  useEffect(() => {
    latest.current = { k, tag };
    clientRef.current?.request(latest.current);
  }, [k, tag]);

  useEffect(() => {
    if (image === null) return;
    const client = createPaletteClient(
      image,
      latest.current,
      (answeredTag, swatches) => {
        setOutcome({ tag: answeredTag, swatches });
      },
      known.current,
    );
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [image, attempt]);

  const onImage = useCallback((img: HTMLImageElement) => {
    if (img.naturalWidth > 0) setImage(img);
  }, []);
  const onImageError = useCallback(() => {
    setImageFailed(true);
  }, []);
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const answered = outcome?.tag === tag ? outcome.swatches : undefined;
  let status: PaletteStatus = image === null ? 'waiting' : 'loading';
  if (imageFailed) status = 'unavailable';
  if (answered === null) status = 'error';
  else if (answered !== undefined) status = 'ready';
  return { status, swatches: answered ?? [], k, image, setK, retry, onImage, onImageError };
}
