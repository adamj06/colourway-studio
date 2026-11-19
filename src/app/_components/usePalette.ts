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
  /** True while the palette is the one a share link brought, before the user has changed k. */
  linked: boolean;
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

const knownFrom = (hexes: readonly string[] | null): KnownSwatch[] | null =>
  hexes === null ? null : hexes.map((hex) => ({ hex, lab: labOfHex(hex) }));

/** A link's palette is shown with k as near its size as the control allows. */
const initialK = (hexes: readonly string[] | null): number =>
  hexes === null ? DEFAULT_K : Math.min(MAX_K, Math.max(MIN_K, hexes.length));

/** `answered`: swatches when the worker has answered for the current tag, null when it failed, undefined while waiting. */
function statusOf(imageLoaded: boolean, imageFailed: boolean, answered: Swatch[] | null | undefined): PaletteStatus {
  if (answered === null) return 'error';
  if (answered !== undefined) return 'ready';
  if (imageFailed) return 'unavailable';
  return imageLoaded ? 'loading' : 'waiting';
}

/**
 * Palette state for one design image. The worker is created lazily (only on the design page, only after the image
 * has loaded) and terminated on unmount. The answer is matched to the current k and attempt by tag, so a late
 * answer for an older k can never be shown.
 */
export function usePalette(fromLink: readonly string[] | null = null): PaletteView {
  // A palette from a share link is used as it is (its shares are measured, nothing is extracted) until k is changed.
  const [initial] = useState(() => knownFrom(fromLink));
  const known = useRef(initial);
  // Counts the user's own changes of k. It is part of every tag, so an answer for the link's palette can never be
  // mistaken for the answer to a request made after k was changed (6, then 5, then 6 again).
  const [generation, setGeneration] = useState(0);
  const [k, setRequestedK] = useState(() => initialK(fromLink));
  const setK = useCallback((next: number) => {
    known.current = null;
    setGeneration((value) => value + 1);
    setRequestedK(next);
  }, []);
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const clientRef = useRef<PaletteClient | null>(null);
  const tag = `${String(attempt)}:${String(k)}:${String(generation)}`;
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
      () => known.current,
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
  return {
    status: statusOf(image !== null, imageFailed, answered),
    swatches: answered ?? [],
    k,
    linked: initial !== null && generation === 0,
    image,
    setK,
    retry,
    onImage,
    onImageError,
  };
}
