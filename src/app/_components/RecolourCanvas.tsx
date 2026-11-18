'use client';

import { useEffect, useRef } from 'react';
import type { Frame } from './recolourClient';

/** Draws one recoloured frame. role="img" with a label: a canvas has no text alternative of its own. */
export function RecolourCanvas({ frame, alt, className }: { frame: Frame; alt: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = ref.current?.getContext('2d');
    if (!context) return;
    context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
  }, [frame]);

  return (
    <canvas ref={ref} width={frame.width} height={frame.height} role="img" aria-label={alt} className={className} />
  );
}
