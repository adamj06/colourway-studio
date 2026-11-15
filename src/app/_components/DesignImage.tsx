import type { SyntheticEvent } from 'react';
import { iiifImageUrl } from '@/lib/vam/iiif';

type Props = {
  imageBaseUrl: string;
  /** Longest side to request from the IIIF server, in pixels. */
  size: number;
  alt: string;
  priority?: boolean;
  className?: string;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
};

/**
 * A plain <img>, not next/image: the IIIF server already resizes (`!size,size`), so Vercel image optimisation
 * would only burn quota. crossOrigin is ALWAYS set so a cached non-CORS copy can never taint a canvas later
 * (framemark sends Access-Control-Allow-Origin: *, spike result in ADR 0002).
 */
export function DesignImage({ imageBaseUrl, size, alt, priority = false, className, onLoad }: Props) {
  return (
    <img
      onLoad={onLoad}
      src={iiifImageUrl(imageBaseUrl, size, size)}
      alt={alt}
      width={size}
      height={size}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      crossOrigin="anonymous"
      className={className}
    />
  );
}
