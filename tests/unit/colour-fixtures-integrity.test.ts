import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The reference data is the oracle for the colour maths, so a silent change would make a wrong implementation look
// correct. These checks pin it. The hash is of the file exactly as downloaded from the authors' page on 2026-11-15
// (tests/fixtures/colour/README.md). If a deliberate refetch changes it, update the hash AND the README together.
const SHARMA_RAW_SHA256 = '44aebb39107128328add54fbef5ac8ee89909e50508f448a1580adea2058a4b8';
const DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'colour');
const read = (name: string): Buffer => readFileSync(path.join(DIR, name));
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

describe('colour reference fixtures', () => {
  it('keeps the raw Sharma (2005) file byte for byte as published', () => {
    expect(sha256(read('ciede2000testdata.txt'))).toBe(SHARMA_RAW_SHA256);
  });

  it('records that same hash in the generated sharma-2005.json', () => {
    const json = JSON.parse(read('sharma-2005.json').toString('utf8')) as { source: { rawSha256: string } };
    expect(json.source.rawSha256).toBe(SHARMA_RAW_SHA256);
  });

  it('records which pinned colour-science run produced the sRGB to Lab oracle', () => {
    const json = JSON.parse(read('srgb-lab-reference.json').toString('utf8')) as {
      source: { package: string; version: string; script: string };
      illuminant: string;
    };
    expect(json.source).toMatchObject({
      package: 'colour-science',
      version: '0.4.7',
      script: 'scripts/gen-lab-reference.py',
    });
    expect(json.illuminant).toBe('D65');
  });
});
