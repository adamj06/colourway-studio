// Feature 005 (export): expects `src/lib/png/attribution.ts` to export
//   exportTextEntries(systemNumber: string): Array<{ keyword: string; text: string }>
// System numbers look like O78207 (the V&A fixtures in tests/fixtures/vam, and /^O\d{1,10}$/ in src/lib/api/params.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { exportTextEntries } from './attribution';

describe('exportTextEntries', () => {
  it('returns the Source and Software entries, in that order, with the exact wording', () => {
    expect(exportTextEntries('O78207')).toEqual([
      { keyword: 'Source', text: 'Victoria and Albert Museum, London (O78207)' },
      { keyword: 'Software', text: 'Colourway Studio' },
    ]);
  });

  it('puts the given system number in the Source text', () => {
    expect(exportTextEntries('O1')[0]?.text).toBe('Victoria and Albert Museum, London (O1)');
    expect(exportTextEntries('O1234567890')[0]?.text).toBe('Victoria and Albert Museum, London (O1234567890)');
  });

  it('works for the real system number in the V&A fixture', () => {
    const fixture = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../../../tests/fixtures/vam/museumobject-O78207.json'), 'utf8'),
    ) as { record: { systemNumber: string } };
    expect(fixture.record.systemNumber).toBe('O78207');
    expect(exportTextEntries(fixture.record.systemNumber)[0]?.text).toBe('Victoria and Albert Museum, London (O78207)');
  });

  it('uses only Latin-1 characters (no curly apostrophe) and no NUL', () => {
    for (const entry of exportTextEntries('O78207')) {
      for (const ch of `${entry.keyword}${entry.text}`) {
        expect(
          ch.codePointAt(0) ?? 0,
          `${entry.keyword}: U+${(ch.codePointAt(0) ?? 0).toString(16)}`,
        ).toBeLessThanOrEqual(0xff);
        expect(ch).not.toBe('\u0000');
      }
    }
  });

  it('gives keywords valid for a PNG tEXt chunk: 1 to 79 chars, no leading or trailing space', () => {
    for (const { keyword } of exportTextEntries('O78207')) {
      expect(keyword.length).toBeGreaterThanOrEqual(1);
      expect(keyword.length).toBeLessThanOrEqual(79);
      expect(keyword).toBe(keyword.trim());
    }
  });
});
