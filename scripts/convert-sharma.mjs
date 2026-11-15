#!/usr/bin/env node
// Converts the authors' published Sharma (2005) CIEDE2000 test data into JSON.
//
//   input:  tests/fixtures/colour/ciede2000testdata.txt  (byte-for-byte as published, see the README beside it)
//   output: tests/fixtures/colour/sharma-2005.json
//
// Nothing is typed in or edited by hand: every number comes from the raw file. A unit test re-parses the raw
// file independently and asserts it equals the JSON, so the JSON cannot drift from the published source.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'colour');
const rawPath = path.join(dir, 'ciede2000testdata.txt');
const outPath = path.join(dir, 'sharma-2005.json');

const raw = readFileSync(rawPath);
const rows = raw
  .toString('utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');

const pairs = rows.map((line, index) => {
  const cells = line.split('\t').map(Number);
  if (cells.length !== 7 || cells.some((n) => !Number.isFinite(n))) {
    throw new Error(`Row ${String(index + 1)} is not 7 tab-separated numbers: ${line}`);
  }
  const [L1, a1, b1, L2, a2, b2, deltaE] = cells;
  return { pair: index + 1, lab1: [L1, a1, b1], lab2: [L2, a2, b2], deltaE };
});

if (pairs.length !== 34) throw new Error(`Expected 34 test pairs, found ${String(pairs.length)}`);

const document = {
  description:
    'Sharma, Wu and Dalal (2005) CIEDE2000 test pairs: Lab1, Lab2 and the expected delta E 2000. Generated from the raw file by scripts/convert-sharma.mjs, do not edit by hand.',
  source: {
    url: 'https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt',
    rawFile: 'ciede2000testdata.txt',
    rawSha256: createHash('sha256').update(raw).digest('hex'),
  },
  pairs,
};

// Arrays on one line, so the file is stable under Prettier and diffs stay readable.
const text = JSON.stringify(document, null, 2).replace(
  /\[\s*(-?\d[^[\]{}"]*?)\s*\]/g,
  (_match, inner) => `[${inner.replace(/\s+/g, ' ')}]`,
);
writeFileSync(outPath, `${text}\n`);
process.stdout.write(`wrote ${String(pairs.length)} pairs to ${outPath}\n`);
