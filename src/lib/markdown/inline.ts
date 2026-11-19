import type { Inline } from './ast';
import { isSafeHref } from './href';

const MAX_DEPTH = 6;
// Bracket matching rescans for every `[`, so a pathological line is quadratic. Real prose is far shorter.
const MAX_INLINE_LENGTH = 20_000;
const PUNCTUATION = /^[!-/:-@[-`{-~]$/;

interface Match {
  nodes: Inline[];
  end: number;
}

function pushText(out: Inline[], value: string): void {
  const last = out[out.length - 1];
  if (last?.type === 'text') last.value += value;
  else out.push({ type: 'text', value });
}

function pushAll(out: Inline[], nodes: readonly Inline[]): void {
  for (const node of nodes) {
    if (node.type === 'text') pushText(out, node.value);
    else out.push(node);
  }
}

// `charAt` is '' out of range, which none of these tests match, so no bounds checks are needed.
const isWord = (ch: string): boolean => /^[\p{L}\p{N}]$/u.test(ch);
const hasEdgeSpace = (s: string): boolean => s.trim() !== s;

function matchCode(src: string, i: number): Match | null {
  const close = src.indexOf('`', i + 1);
  if (close <= i + 1) return null;
  return { nodes: [{ type: 'code', value: src.slice(i + 1, close) }], end: close + 1 };
}

/** Index of the `]` that closes the `[` at `i`, skipping escapes and nested brackets. */
function findLabelEnd(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src.charAt(j);
    if (ch === '\\') j++;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return j;
  }
  return -1;
}

/** Index of the `)` that closes the `(` at `i`, allowing balanced parentheses inside. */
function findDestinationEnd(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src.charAt(j);
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return j;
  }
  return -1;
}

function matchLink(src: string, i: number, depth: number): Match | null {
  const labelEnd = findLabelEnd(src, i);
  if (labelEnd < 0 || src.charAt(labelEnd + 1) !== '(') return null;
  const destEnd = findDestinationEnd(src, labelEnd + 1);
  if (destEnd < 0) return null;

  const children = parseInline(src.slice(i + 1, labelEnd), depth + 1);
  const href = src.slice(labelEnd + 2, destEnd);
  // A refused href leaves just the link text, as plain text.
  const nodes: Inline[] = isSafeHref(href) ? [{ type: 'link', href, children }] : children;
  return { nodes, end: destEnd + 1 };
}

function matchStrong(src: string, i: number, depth: number): Match {
  const close = src.indexOf('**', i + 2);
  const content = close < 0 ? '' : src.slice(i + 2, close);
  if (content === '' || hasEdgeSpace(content)) return { nodes: [{ type: 'text', value: '**' }], end: i + 2 };
  return { nodes: [{ type: 'strong', children: parseInline(content, depth + 1) }], end: close + 2 };
}

function matchEm(src: string, i: number, depth: number): Match | null {
  const marker = src.charAt(i);
  if (marker === '_' && isWord(src.charAt(i - 1))) return null;
  const close = src.indexOf(marker, i + 1);
  if (close < 0) return null;
  const content = src.slice(i + 1, close);
  if (content === '' || hasEdgeSpace(content)) return null;
  if (marker === '_' && isWord(src.charAt(close + 1))) return null;
  return { nodes: [{ type: 'em', children: parseInline(content, depth + 1) }], end: close + 1 };
}

function matchAt(src: string, i: number, depth: number): Match | null {
  const ch = src.charAt(i);
  if (ch === '`') return matchCode(src, i);
  if (ch === '[') return matchLink(src, i, depth);
  if (ch === '*' && src.charAt(i + 1) === '*') return matchStrong(src, i, depth);
  if (ch === '*' || ch === '_') return matchEm(src, i, depth);
  return null;
}

/** Inline parser. Total: anything it cannot make sense of stays as literal text. */
export function parseInline(src: string, depth = 0): Inline[] {
  if (depth >= MAX_DEPTH || src.length > MAX_INLINE_LENGTH) return [{ type: 'text', value: src }];
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    const next = src.charAt(i + 1);
    if (ch === '\\' && PUNCTUATION.test(next)) {
      pushText(out, next);
      i += 2;
      continue;
    }
    const match = matchAt(src, i, depth);
    if (match) {
      pushAll(out, match.nodes);
      i = match.end;
    } else {
      pushText(out, ch);
      i++;
    }
  }
  return out;
}
