// Edge cases beyond the main specs for the ADR, friction and build-log parsers.
import { describe, expect, it } from 'vitest';

import { parseAdr } from './adr';
import { parseBuildLog } from './buildLog';
import { parseFrictionLog } from './friction';

const entry = {
  id: 'x',
  title: 'X',
  date: '2026-11-15',
  summary: 's',
  models: [],
  subagents: [],
  humanInterventions: [],
  reviewFindingsFixed: 0,
  prUrl: null,
};

describe('parseAdr edges', () => {
  const ok = (filename: string, md: string) => {
    const r = parseAdr(filename, md);
    if (!r.ok) throw new Error(r.error);
    return r.adr;
  };

  it('gives empty status and date when the bullets are missing, and keeps the body', () => {
    const adr = ok('0001-x.md', '# ADR 0001: T\n\n## Context\n\nc');
    expect(adr).toMatchObject({ status: '', date: '' });
    expect(adr.body).toBe('## Context\n\nc');
  });

  it('allows blank lines before the title', () => {
    expect(ok('0001-x.md', '\n\n# ADR 0001: T\n\n- **Status:** Accepted').status).toBe('Accepted');
  });

  it('only strips Status and Date bullets from the preamble, not from later sections', () => {
    const adr = ok(
      '0001-x.md',
      '# ADR 0001: T\n\n- **Status:** Accepted\n\n## Notes\n\n- **Status:** quoted\n- **Date:** quoted',
    );
    expect(adr.status).toBe('Accepted');
    expect(adr.body).toContain('- **Status:** quoted');
    expect(adr.body).toContain('- **Date:** quoted');
  });
});

describe('parseFrictionLog edges', () => {
  it('ignores a bullet with an unknown label and stops continuing the previous field', () => {
    const md =
      '## 2026-11-15 10:00: t\n\n- **Doing:** a\n- **Other:** ignored\n  stray continuation\n- **Caught by:** human\n';
    const [e] = parseFrictionLog(md);
    expect(e).toMatchObject({ doing: 'a', caughtBy: 'human' });
    expect(JSON.stringify(e)).not.toContain('ignored');
    expect(JSON.stringify(e)).not.toContain('stray');
  });

  it('stops a field at an unindented non-bullet line', () => {
    const md = '## 2026-11-15 10:00: t\n\n- **Doing:** a\n---\n  not part of doing\n';
    expect(parseFrictionLog(md)[0]!.doing).toBe('a');
  });

  it('ends an entry at any other level-2 heading', () => {
    const md = '## 2026-11-15 10:00: t\n\n- **Doing:** a\n\n## Notes\n\n- **Caught by:** nobody\n';
    expect(parseFrictionLog(md)[0]).toMatchObject({ doing: 'a', caughtBy: '' });
  });

  it('ignores text before the first entry, even bullets with known labels', () => {
    const md = '- **Doing:** stray\n\n## 2026-11-15 10:00: t\n';
    expect(parseFrictionLog(md)[0]!.doing).toBe('');
  });

  it('takes a continuation line when the bullet itself was empty', () => {
    const md = '## 2026-11-15 10:00: t\n\n- **Doing:**\n  on the next line\n';
    expect(parseFrictionLog(md)[0]!.doing).toBe('on the next line');
  });

  it('ignores fenced content inside an entry', () => {
    const md =
      '## 2026-11-15 10:00: t\n\n- **Doing:** a\n\n```\n- **Caught by:** fake\n## 2026-11-15 11:00: fake\n```\n';
    const entries = parseFrictionLog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.caughtBy).toBe('');
  });
});

describe('parseBuildLog edges', () => {
  it('rejects a prUrl that starts with https:// but is not a URL', () => {
    const r = parseBuildLog([{ ...entry, prUrl: 'https://' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\[0\]\.prUrl/);
  });

  it('rejects an impossible calendar date that has the right shape', () => {
    const r = parseBuildLog([{ ...entry, date: '2026-02-30' }]);
    expect(r.ok).toBe(false);
  });

  it('reports every problem, one per line', () => {
    const r = parseBuildLog([{ ...entry, title: '', reviewFindingsFixed: -1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.split('\n').length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseBuildLog prUrl is a GitHub pull request link', () => {
  const rejected = (prUrl: string) => parseBuildLog([{ ...entry, prUrl }]).ok;

  it('accepts github.com pull request URLs', () => {
    expect(rejected('https://github.com/adamj06/colourway-studio/pull/16')).toBe(true);
  });

  it('rejects other hosts, lookalikes and credentials', () => {
    for (const url of [
      'https://evil.example/a/b/pull/1',
      'https://github.com.evil.example/a/b/pull/1',
      'https://user:pass@github.com/a/b/pull/1',
      'https://user@github.com/a/b/pull/1',
      'https://github.com:8443/a/b/pull/1',
    ]) {
      expect(rejected(url), url).toBe(false);
    }
  });

  it('rejects github.com URLs that are not a pull request', () => {
    for (const url of [
      'https://github.com/a/b',
      'https://github.com/a/b/issues/1',
      'https://github.com/a/b/pull/x',
      'https://github.com/a/b/pull/1/files',
      'https://github.com/a/b/pull/',
    ]) {
      expect(rejected(url), url).toBe(false);
    }
  });
});
