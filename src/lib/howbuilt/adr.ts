import { at, group } from '../text/safe';

export interface Adr {
  number: number;
  slug: string;
  title: string;
  status: string;
  date: string;
  body: string;
}

export type AdrResult = { ok: true; adr: Adr } | { ok: false; error: string };

const FILENAME = /^(\d{4})-(.+)\.md$/;
const TEMPLATE = '0000-template.md';
const TITLE = /^#\s+ADR\s+\d+:\s*(\S.*)$/;
const STATUS = /^-\s+\*\*Status:\*\*\s*(.*)$/;
const DATE = /^-\s+\*\*Date:\*\*\s*(.*)$/;

export function isAdrFile(filename: string): boolean {
  return FILENAME.test(filename) && filename !== TEMPLATE;
}

interface Preamble {
  status: string;
  date: string;
  rest: string[];
}

/** Pulls the Status and Date bullets out of the lines before the first `##` heading. */
function splitPreamble(lines: readonly string[]): Preamble {
  let status = '';
  let date = '';
  const rest: string[] = [];
  let inPreamble = true;
  for (const line of lines) {
    if (inPreamble && line.startsWith('## ')) inPreamble = false;
    const statusMatch = inPreamble ? STATUS.exec(line) : null;
    const dateMatch = inPreamble ? DATE.exec(line) : null;
    if (statusMatch) status = group(statusMatch, 1).trim();
    else if (dateMatch) date = group(dateMatch, 1).trim();
    else rest.push(line);
  }
  return { status, date, rest };
}

export function parseAdr(filename: string, md: string): AdrResult {
  const name = FILENAME.exec(filename);
  if (!name) return { ok: false, error: `${filename}: not a numbered ADR filename (NNNN-slug.md)` };

  const lines = md.split(/\r?\n/);
  const firstIndex = lines.findIndex((line) => line.trim() !== '');
  // With no non-blank line, firstIndex is -1 and `at` gives '', which is not a title.
  const title = group(TITLE.exec(at(lines, firstIndex)), 1).trim();
  if (title === '') return { ok: false, error: `${filename}: missing "# ADR NNNN: Title" heading` };

  const { status, date, rest } = splitPreamble(lines.slice(firstIndex + 1));
  return {
    ok: true,
    adr: {
      number: Number.parseInt(group(name, 1), 10),
      slug: group(name, 2),
      title,
      status,
      date,
      body: rest.join('\n').trim(),
    },
  };
}

export function parseAdrs(files: readonly { filename: string; content: string }[]): {
  adrs: Adr[];
  errors: string[];
} {
  const adrs: Adr[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!isAdrFile(file.filename)) continue;
    const result = parseAdr(file.filename, file.content);
    if (result.ok) adrs.push(result.adr);
    else errors.push(result.error);
  }
  adrs.sort((a, b) => a.number - b.number);
  return { adrs, errors };
}
