import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Set by Vercel. Absent locally, which is how local `next start` is told apart from a real deploy.
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

/** Validates raw environment variables. Throws one readable Error naming every bad variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment variables: ${problems}`);
}

// The only place in the app that reads process.env (lint enforced).
export const env: Env = parseEnv(process.env);
