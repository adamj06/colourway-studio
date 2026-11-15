export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type LogFn = (msg: string, fields?: LogFields) => void;
export type Logger = { info: LogFn; warn: LogFn; error: LogFn };

export type LoggerOptions = {
  route: string;
  write?: (line: string) => void;
  now?: () => number;
};

// Never written to a log, whatever the caller passes (CLAUDE.md: never log request bodies or headers).
const FORBIDDEN_KEYS = new Set(['headers', 'body', 'authorization', 'cookie']);
const RESERVED_KEYS = new Set(['level', 'msg', 'route', 'ts']);

function scrub(fields: LogFields, depth: number): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    const isPlainObject = typeof value === 'object' && value !== null && !Array.isArray(value);
    out[key] = depth > 0 && isPlainObject ? scrub(value as LogFields, depth - 1) : value;
  }
  return out;
}

function serialise(record: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(record, (_key, value: unknown) => {
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  } catch {
    return JSON.stringify({ level: record.level, msg: record.msg, route: record.route, ts: record.ts });
  }
}

// The one place allowed to call console (eslint.config.mjs).
const defaultWrite = (line: string): void => {
  console.log(line);
};

/** Structured JSON logger: one line per call with level, msg, route and ts, plus scrubbed extra fields. */
export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? defaultWrite;
  const now = options.now ?? Date.now;

  const log =
    (level: LogLevel): LogFn =>
    (msg, fields = {}) => {
      const extra = Object.fromEntries(Object.entries(scrub(fields, 1)).filter(([key]) => !RESERVED_KEYS.has(key)));
      write(serialise({ ...extra, level, msg, route: options.route, ts: now() }));
    };

  return { info: log('info'), warn: log('warn'), error: log('error') };
}
