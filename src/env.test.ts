import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parses a minimal valid environment', () => {
    const result = parseEnv({ NODE_ENV: 'production' });
    expect(result.NODE_ENV).toBe('production');
  });

  it.each(['production', 'preview', 'development'] as const)('accepts VERCEL_ENV=%s', (v) => {
    expect(parseEnv({ NODE_ENV: 'test', VERCEL_ENV: v }).VERCEL_ENV).toBe(v);
  });

  it('leaves unset optional values undefined', () => {
    const result = parseEnv({ NODE_ENV: 'test' });
    expect(result.VERCEL_ENV).toBeUndefined();
    expect(result.VERCEL_GIT_COMMIT_SHA).toBeUndefined();
  });

  it('accepts a commit SHA', () => {
    expect(parseEnv({ NODE_ENV: 'test', VERCEL_GIT_COMMIT_SHA: 'abc123' }).VERCEL_GIT_COMMIT_SHA).toBe('abc123');
  });

  it('defaults NODE_ENV to development when unset', () => {
    expect(parseEnv({}).NODE_ENV).toBe('development');
  });

  it('rejects an invalid VERCEL_ENV with a readable message naming the variable', () => {
    let error: unknown;
    try {
      parseEnv({ NODE_ENV: 'test', VERCEL_ENV: 'staging' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('VERCEL_ENV');
    expect(message.trimStart().startsWith('[')).toBe(false);
    expect(message.trimStart().startsWith('{')).toBe(false);
    expect(message).not.toContain('"code"');
  });

  it('rejects an invalid NODE_ENV and names the variable', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects an empty VERCEL_GIT_COMMIT_SHA', () => {
    expect(() => parseEnv({ NODE_ENV: 'test', VERCEL_GIT_COMMIT_SHA: '' })).toThrow(/VERCEL_GIT_COMMIT_SHA/);
  });

  it('ignores unknown extra variables', () => {
    const result = parseEnv({ NODE_ENV: 'test', SOMETHING_ELSE: 'x', PATH: '/bin' });
    expect(result.NODE_ENV).toBe('test');
  });

  it('does not mutate its input', () => {
    const input = { NODE_ENV: 'production', VERCEL_ENV: 'preview', EXTRA: 'x' };
    const copy = { ...input };
    parseEnv(input);
    expect(input).toEqual(copy);
  });
});

describe('env', () => {
  it('is defined at import and has a NODE_ENV', async () => {
    const mod = await import('./env');
    expect(mod.env).toBeDefined();
    expect(mod.env.NODE_ENV).toBeTruthy();
  });
});
