import { at } from '../text/safe';
import type { Block } from './ast';
import { parseInline } from './inline';

const DELIMITER_CELL = /^:?-+:?$/;

/** Splits a table row into trimmed cells, honouring `\|` escapes and optional outer pipes. */
export function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isDelimiterRow(line: string, columns: number): boolean {
  const cells = splitRow(line);
  return cells.length === columns && cells.every((cell) => DELIMITER_CELL.test(cell));
}

type Table = Extract<Block, { type: 'table' }>;

/** Reads a GFM table starting at `lines[start]`, or returns null when there is no delimiter row. */
export function readTable(lines: readonly string[], start: number): { block: Table; next: number } | null {
  const head = at(lines, start);
  const headerCells = splitRow(head);
  if (!head.includes('|') || !isDelimiterRow(at(lines, start + 1), headerCells.length)) return null;

  const rows: string[][] = [];
  let next = start + 2;
  while (next < lines.length && at(lines, next).includes('|')) {
    const cells = splitRow(at(lines, next));
    // Short rows are padded and long rows truncated to the header width.
    rows.push(headerCells.map((_, column) => at(cells, column)));
    next++;
  }
  return {
    block: {
      type: 'table',
      header: headerCells.map((cell) => parseInline(cell)),
      rows: rows.map((row) => row.map((cell) => parseInline(cell))),
    },
    next,
  };
}
