/**
 * Indexed read for places where the index is known to be in range (loop bounds, lengths checked by the caller).
 * `noUncheckedIndexedAccess` types `a[i]` as possibly undefined; a `?? 0` fallback there would be an unreachable
 * branch (and an untestable mutant), so the assertion lives in this one place instead.
 */
export function at<T>(items: ArrayLike<T>, index: number): T {
  return items[index] as T;
}
