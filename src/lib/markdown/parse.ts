import { at, group } from '../text/safe';
import type { Block } from './ast';
import { parseInline } from './inline';
import { readTable } from './table';

export type { Block, Inline } from './ast';
export { parseInline } from './inline';

const FENCE = /^ {0,3}(`{3,})[ \t]*([^`\s]*)[^`]*$/;
const CLOSING_FENCE = /^ {0,3}(`{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*?)[ \t]*$/;
const THEMATIC = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/;
const ORDERED = /^ {0,3}\d{1,9}[.)][ \t]+(.*)$/;
const INDENTED = /^\s+\S/;

interface Read {
  block: Block | null;
  next: number;
}

const isBlank = (line: string): boolean => line.trim() === '';

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || THEMATIC.test(line) || BULLET.test(line) || ORDERED.test(line);
}

function readFence(lines: readonly string[], i: number): Read | null {
  const open = FENCE.exec(at(lines, i));
  if (!open) return null;
  const fenceLength = group(open, 1).length;
  const body: string[] = [];
  let next = i + 1;
  while (next < lines.length) {
    const line = at(lines, next);
    next++;
    // Only a fence at least as long as the opening one closes the block.
    if (group(CLOSING_FENCE.exec(line), 1).length >= fenceLength) break;
    body.push(line);
  }
  return { block: { type: 'code', lang: group(open, 2) || null, value: body.join('\n') }, next };
}

function readHeading(lines: readonly string[], i: number): Read | null {
  const match = HEADING.exec(at(lines, i));
  if (!match) return null;
  const level = group(match, 1).length as 1 | 2 | 3 | 4 | 5 | 6;
  return { block: { type: 'heading', level, children: parseInline(group(match, 2)) }, next: i + 1 };
}

function readThematicBreak(lines: readonly string[], i: number): Read | null {
  // A horizontal rule has no node of its own: it is dropped.
  return THEMATIC.test(at(lines, i)) ? { block: null, next: i + 1 } : null;
}

function readItem(lines: readonly string[], i: number, marker: RegExp): { text: string; next: number } {
  const parts = [group(marker.exec(at(lines, i)), 1).trim()];
  let next = i + 1;
  while (next < lines.length && INDENTED.test(at(lines, next)) && !marker.test(at(lines, next))) {
    parts.push(at(lines, next).trim());
    next++;
  }
  return { text: parts.filter((p) => p !== '').join(' '), next };
}

function nextNonBlank(lines: readonly string[], from: number): number {
  let j = from;
  while (j < lines.length && isBlank(at(lines, j))) j++;
  return j;
}

function readList(lines: readonly string[], i: number): Read | null {
  const first = at(lines, i);
  const ordered = !BULLET.test(first) && ORDERED.test(first);
  const marker = ordered ? ORDERED : BULLET;
  if (!marker.test(first)) return null;

  const items: string[] = [];
  let next = i;
  while (marker.test(at(lines, next))) {
    const item = readItem(lines, next, marker);
    items.push(item.text);
    // One blank line between items still belongs to the same (loose) list.
    const after = nextNonBlank(lines, item.next);
    next = marker.test(at(lines, after)) ? after : item.next;
  }
  return { block: { type: 'list', ordered, items: items.map((text) => parseInline(text)) }, next };
}

function readParagraph(lines: readonly string[], i: number): Read {
  const parts = [at(lines, i).trim()];
  let next = i + 1;
  while (next < lines.length && !isBlank(at(lines, next)) && !startsBlock(at(lines, next))) {
    parts.push(at(lines, next).trim());
    next++;
  }
  return { block: { type: 'paragraph', children: parseInline(parts.join(' ')) }, next };
}

function readBlock(lines: readonly string[], i: number): Read {
  const table = readTable(lines, i);
  return (
    readFence(lines, i) ??
    readHeading(lines, i) ??
    readThematicBreak(lines, i) ??
    table ??
    readList(lines, i) ??
    readParagraph(lines, i)
  );
}

/** Parses the Markdown subset used by our docs. Pure and total: it never throws. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(at(lines, i))) {
      i++;
      continue;
    }
    const read = readBlock(lines, i);
    if (read.block) blocks.push(read.block);
    i = Math.max(read.next, i + 1);
  }
  return blocks;
}
