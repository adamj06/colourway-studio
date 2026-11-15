import { VamError, type VamErrorCode } from './client';

// A `use cache` function can't signal failure by throwing: an error that crosses the cache boundary is serialised
// and comes back as a plain Error (the class, code and status are lost, so everything became a 500). Cached
// functions therefore return an Outcome, and the caller turns it back into a thrown VamError.

export type Outcome<T> = { ok: true; value: T } | { ok: false; code: VamErrorCode; upstreamStatus?: number };

export async function toOutcome<T>(work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof VamError) {
      return {
        ok: false,
        code: error.code,
        ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
      };
    }
    return { ok: false, code: 'upstream' };
  }
}

/** The value, or a thrown VamError rebuilt from the outcome. Messages are fixed: the original text isn't carried. */
export function fromOutcome<T>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome.value;
  throw new VamError(outcome.code, `V&A request failed: ${outcome.code}`, outcome.upstreamStatus);
}

/** Answers that won't change soon (a result, or a design that doesn't exist) are cached long; failures only briefly. */
export const isStable = (outcome: Outcome<unknown>): boolean => outcome.ok || outcome.code === 'not_found';
