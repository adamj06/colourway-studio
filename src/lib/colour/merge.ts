import type { Lab } from './types';

export function mergeClusters(
  _clusters: { lab: Lab; count: number }[],
  _threshold: number,
): { lab: Lab; count: number }[] {
  throw new Error('not implemented', { cause: [_clusters, _threshold] });
}
