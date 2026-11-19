import { z } from 'zod';

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, { message: 'not a real calendar date' });

const prUrl = z
  .string()
  .refine(
    (s) => {
      if (!s.startsWith('https://')) return false;
      try {
        return new URL(s).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'must be an https URL' },
  )
  .nullable();

// Strict: a typo'd key in the log fails the build instead of being silently dropped.
const entrySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  date,
  summary: z.string(),
  models: z.array(z.string()),
  subagents: z.array(z.string()),
  humanInterventions: z.array(z.string()),
  reviewFindingsFixed: z.number().int().nonnegative(),
  prUrl,
});

const logSchema = z.array(entrySchema);

export type BuildLogEntry = z.infer<typeof entrySchema>;

export type BuildLogResult = { ok: true; entries: BuildLogEntry[] } | { ok: false; error: string };

const formatPath = (path: readonly PropertyKey[]): string =>
  path.map((part) => (typeof part === 'number' ? `[${String(part)}]` : `.${String(part)}`)).join('');

/** Validates data/build-log.json. Errors name the failing path, e.g. `[2].reviewFindingsFixed`. */
export function parseBuildLog(input: unknown): BuildLogResult {
  const parsed = logSchema.safeParse(input);
  if (parsed.success) return { ok: true, entries: parsed.data };
  const error = parsed.error.issues
    .map((issue) => `${formatPath(issue.path) || 'build log'}: ${issue.message}`)
    .join('\n');
  return { ok: false, error };
}
