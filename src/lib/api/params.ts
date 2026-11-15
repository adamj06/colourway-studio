import { z } from 'zod';
import { MAX_PAGE, MAX_QUERY_LENGTH } from './query-limits';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const qSchema = z.string().trim().max(MAX_QUERY_LENGTH);
const pageSchema = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_PAGE));
const systemNumberSchema = z.string().regex(/^O\d{1,10}$/);

/** Reads a query param that must appear at most once. `undefined` means absent. */
function single(sp: URLSearchParams, name: string): { ok: true; value: string | undefined } | { ok: false } {
  const all = sp.getAll(name);
  return all.length > 1 ? { ok: false } : { ok: true, value: all[0] };
}

/** Validates /api/vam/search query params. Unknown params are ignored, never forwarded. */
export function parseSearchParams(sp: URLSearchParams): ParseResult<{ q: string; page: number }> {
  const rawQ = single(sp, 'q');
  const rawPage = single(sp, 'page');
  if (!rawQ.ok || !rawPage.ok) return { ok: false, message: 'q and page may each be given at most once' };

  const q = qSchema.safeParse(rawQ.value ?? '');
  if (!q.success) return { ok: false, message: `q must be at most ${String(MAX_QUERY_LENGTH)} characters` };

  const page =
    rawPage.value === undefined ? ({ success: true, data: 1 } as const) : pageSchema.safeParse(rawPage.value);
  if (!page.success) return { ok: false, message: `page must be an integer from 1 to ${String(MAX_PAGE)}` };

  return { ok: true, value: { q: q.data, page: page.data } };
}

/** Validates a V&A system number such as O78207. */
export function parseSystemNumber(raw: string): ParseResult<string> {
  const parsed = systemNumberSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: 'systemNumber must look like O78207' };
}
