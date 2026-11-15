import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ route: '/api/x', write: (l) => lines.push(l), now: () => 1_700_000_000_000 });
  const last = () => JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
  return { lines, logger, last };
}

describe('createLogger', () => {
  it('writes exactly one JSON line with level, msg, route and ts', () => {
    const { lines, logger, last } = setup();
    logger.info('hello');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(last()).toMatchObject({ level: 'info', msg: 'hello', route: '/api/x' });
    expect(last()).toHaveProperty('ts');
  });

  it('uses the injected clock for ts', () => {
    const { logger, last } = setup();
    logger.info('t');
    const ts = last().ts;
    expect(ts === 1_700_000_000_000 || ts === new Date(1_700_000_000_000).toISOString()).toBe(true);
  });

  it.each(['info', 'warn', 'error'] as const)('sets level %s', (level) => {
    const { logger, last } = setup();
    logger[level]('m');
    expect(last().level).toBe(level);
  });

  it('includes extra fields such as durationMs and upstreamStatus', () => {
    const { logger, last } = setup();
    logger.info('done', { durationMs: 12, upstreamStatus: 200 });
    expect(last()).toMatchObject({ durationMs: 12, upstreamStatus: 200 });
  });

  it.each(['headers', 'body', 'authorization', 'cookie', 'Headers', 'BODY', 'Authorization', 'COOKIE'])(
    'drops the %s field',
    (key) => {
      const { lines, logger } = setup();
      logger.info('m', { [key]: 'SECRET-VALUE', keep: 1 });
      expect(lines[0]).not.toContain('SECRET-VALUE');
      expect(JSON.parse(lines[0]!)).toMatchObject({ keep: 1 });
    },
  );

  it('drops sensitive keys nested one level deep', () => {
    const { lines, logger, last } = setup();
    logger.info('m', { request: { Authorization: 'Bearer SECRET-VALUE', cookie: 'SECRET-VALUE', url: '/a' } });
    expect(lines[0]).not.toContain('SECRET-VALUE');
    expect(last().request).toMatchObject({ url: '/a' });
  });

  it('does not let a field override level, msg or route', () => {
    const { logger, last } = setup();
    logger.warn('real', { level: 'fake', msg: 'fake', route: '/fake' });
    expect(last()).toMatchObject({ level: 'warn', msg: 'real', route: '/api/x' });
  });

  it('does not throw on circular values and still writes a line', () => {
    const { lines, logger } = setup();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => {
      logger.error('m', { circular });
    }).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(() => {
      JSON.parse(lines[0]!);
    }).not.toThrow();
  });

  it('does not throw on bigint values and still writes a line', () => {
    const { lines, logger } = setup();
    expect(() => {
      logger.info('m', { big: BigInt(10) });
    }).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(() => {
      JSON.parse(lines[0]!);
    }).not.toThrow();
  });
});
