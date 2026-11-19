'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { encodeColourway, readColourwayParam } from '@/lib/colourway/url';
import type { ExportSource } from './exportPng';
import { useColourway } from './useColourway';
import { usePalette } from './usePalette';
import { useRecolour, type RecolourView } from './useRecolour';
import { useShareUrl } from './useShareUrl';

/** What Export PNG can save now, and what it is waiting for when it cannot save anything yet. */
function exportState(
  hasEdits: boolean,
  recolour: RecolourView,
  image: HTMLImageElement | null,
  imageFailed: boolean,
): { source: ExportSource | null; waitingFor: string } {
  // Say so when it will never become available, instead of promising it will.
  if (imageFailed) {
    return { source: null, waitingFor: 'Export isn’t available because the design image couldn’t be loaded.' };
  }
  if (recolour.failed) {
    return { source: null, waitingFor: 'Export isn’t available because we couldn’t recolour this design.' };
  }
  if (!hasEdits) {
    return {
      source: image === null ? null : { kind: 'image', image },
      waitingFor: 'Export is available once the design image has loaded.',
    };
  }
  const settled = recolour.settled ? recolour.frame : null;
  return {
    source: settled === null ? null : { kind: 'frame', frame: settled },
    waitingFor: 'Export is available once the recolouring has finished.',
  };
}

/**
 * Everything the design page knows about the colourway: the palette, the user's edits, the recoloured picture, the
 * link that reproduces it and what Export PNG can save. A `cw` in the address is read once, when the page opens;
 * after that the address only follows the state.
 */
export function useDesignColourway() {
  const search = useSearchParams().toString();
  const [link] = useState(() => readColourwayParam(search));
  const fromLink = link.kind === 'ok' ? link.state : null;

  const palette = usePalette(fromLink?.original ?? null);
  // The link's edits belong to the link's palette: once k has been changed they are gone, even while the new palette loads.
  const colourway = useColourway(palette.swatches, palette.linked ? fromLink : null);
  const recolour = useRecolour({
    image: palette.image,
    swatches: palette.swatches,
    targets: colourway.targets,
    active: colourway.hasEdits && palette.swatches.length > 0,
  });

  const encoded = colourway.hasEdits ? encodeColourway(colourway.state) : null;
  useShareUrl(encoded);

  // What the wall tiles: the same picture the viewer shows (the live frame, preview quality included). Memoised, so
  // the wall is only repainted when the picture really changes.
  const wallFrame = colourway.showOriginal ? null : recolour.frame;
  const wall = useMemo(() => {
    const source: ExportSource | null = wallFrame
      ? { kind: 'frame', frame: wallFrame }
      : palette.image
        ? { kind: 'image', image: palette.image }
        : null;
    return { source, recoloured: wallFrame !== null };
  }, [wallFrame, palette.image]);

  return {
    palette,
    colourway,
    recolour,
    wall,
    share: { encoded, ...exportState(colourway.hasEdits, recolour, palette.image, palette.status === 'unavailable') },
    /** A link was opened but its colours could not be read: the page shows the normal palette and says so. */
    linkUnreadable: link.kind === 'invalid' && !colourway.hasEdits,
  };
}
