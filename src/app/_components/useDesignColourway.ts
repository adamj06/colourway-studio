'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
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
): { source: ExportSource | null; waitingFor: string } {
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
  const colourway = useColourway(palette.swatches, fromLink);
  const recolour = useRecolour({
    image: palette.image,
    swatches: palette.swatches,
    targets: colourway.targets,
    active: colourway.hasEdits && palette.swatches.length > 0,
  });

  const encoded = colourway.hasEdits ? encodeColourway(colourway.state) : null;
  useShareUrl(encoded);

  return {
    palette,
    colourway,
    recolour,
    share: { encoded, ...exportState(colourway.hasEdits, recolour, palette.image) },
    /** A link was opened but its colours could not be read: the page shows the normal palette and says so. */
    linkUnreadable: link.kind === 'invalid' && !colourway.hasEdits,
  };
}
