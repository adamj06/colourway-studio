'use client';

import type { Design } from '@/lib/vam/types';
import { DesignImage } from './DesignImage';
import { RecolourCanvas } from './RecolourCanvas';
import type { PaletteView } from './usePalette';
import type { ColourwayView } from './useColourway';
import type { RecolourView } from './useRecolour';

type Props = { design: Design; palette: PaletteView; colourway: ColourwayView; recolour: RecolourView };

const fit = 'max-h-full max-w-full object-contain';

/** The design picture: the original <img> until a colour is changed, then the recoloured canvas. */
export function DesignViewer({ design, palette, colourway, recolour }: Props) {
  const alt = `${design.title}${design.objectType ? `, ${design.objectType.toLowerCase()}` : ''}`;
  const showFrame = recolour.frame !== null && !colourway.showOriginal;
  return (
    <div>
      <div className="flex aspect-[4/3] max-h-[80vh] items-center justify-center bg-mat">
        {/* Always mounted, only hidden: the palette and recolour workers read this decoded element. */}
        <DesignImage
          imageBaseUrl={design.imageBaseUrl}
          size={1600}
          alt={alt}
          priority
          className={showFrame ? 'hidden' : fit}
          onLoad={(event) => {
            palette.onImage(event.currentTarget);
          }}
          onError={palette.onImageError}
        />
        {recolour.frame !== null && showFrame ? (
          <RecolourCanvas frame={recolour.frame} alt={`${alt}, recoloured`} className={fit} />
        ) : null}
      </div>
      {colourway.hasEdits ? (
        <button
          type="button"
          aria-pressed={colourway.showOriginal}
          onClick={colourway.toggleOriginal}
          className="mt-3 min-h-11 border border-foreground px-3 text-sm aria-pressed:bg-foreground aria-pressed:text-background"
        >
          Show original
        </button>
      ) : null}
      {recolour.failed ? (
        <p role="alert" className="mt-3">
          We couldn’t recolour this image, so the original is showing.{' '}
          <button type="button" onClick={recolour.retry} className="underline">
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
