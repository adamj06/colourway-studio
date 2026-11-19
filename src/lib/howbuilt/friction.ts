import { group } from '../text/safe';

export interface FrictionEntry {
  timestamp: string;
  title: string;
  doing: string;
  wentWrong: string;
  resolvedBy: string;
  prevention: string;
  caughtBy: string;
}

type Field = Exclude<keyof FrictionEntry, 'timestamp' | 'title'>;

const ENTRY_HEADING = /^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\s*(\S.*)$/;
const INDENTED = /^\s+\S/;
const ANY_H2 = /^##(\s|$)/;
const BULLET = /^-\s+\*\*(.+?):\*\*\s*(.*)$/;
const FIELD_BY_LABEL: Readonly<Record<string, Field>> = {
  Doing: 'doing',
  'What went wrong': 'wentWrong',
  'Resolved by': 'resolvedBy',
  Prevention: 'prevention',
  'Caught by': 'caughtBy',
};

interface Draft {
  timestamp: string;
  title: string;
  parts: Record<Field, string[]>;
}

interface State {
  drafts: Draft[];
  current: Draft | undefined;
  field: Field | undefined;
  inFence: boolean;
}

// Code-unit order, returning 0 for equal strings so the sort stays stable for equal timestamps.
const compare = (a: string, b: string): number => (a < b ? -1 : Number(a > b));

const newDraft = (timestamp: string, title: string): Draft => ({
  timestamp,
  title: title.trim(),
  parts: { doing: [], wentWrong: [], resolvedBy: [], prevention: [], caughtBy: [] },
});

function startEntry(state: State, timestamp: string, title: string): void {
  state.current = newDraft(timestamp, title);
  state.field = undefined;
  state.drafts.push(state.current);
}

function addToField(draft: Draft, field: Field, text: string): void {
  const value = text.trim();
  if (value !== '') draft.parts[field].push(value);
}

function handleBodyLine(state: State, draft: Draft, line: string): void {
  const bullet = BULLET.exec(line);
  if (bullet) {
    state.field = FIELD_BY_LABEL[group(bullet, 1)];
    if (state.field) addToField(draft, state.field, group(bullet, 2));
    return;
  }
  if (INDENTED.test(line) && state.field) addToField(draft, state.field, line);
  else if (line.trim() !== '') state.field = undefined;
}

function handleLine(state: State, line: string): void {
  const entry = ENTRY_HEADING.exec(line);
  if (entry) {
    startEntry(state, group(entry, 1), group(entry, 2));
  } else if (ANY_H2.test(line)) {
    state.current = undefined;
    state.field = undefined;
  } else if (state.current) {
    handleBodyLine(state, state.current, line);
  }
}

/** Parses docs/friction-log.md into entries, newest first. Never throws. */
export function parseFrictionLog(md: string): FrictionEntry[] {
  const state: State = { drafts: [], current: undefined, field: undefined, inFence: false };
  for (const line of md.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) state.inFence = !state.inFence;
    else if (!state.inFence) handleLine(state, line);
  }

  const join = (d: Draft, f: Field): string => d.parts[f].join(' ');
  return state.drafts
    .map((d) => ({
      timestamp: d.timestamp,
      title: d.title,
      doing: join(d, 'doing'),
      wentWrong: join(d, 'wentWrong'),
      resolvedBy: join(d, 'resolvedBy'),
      prevention: join(d, 'prevention'),
      caughtBy: join(d, 'caughtBy'),
    }))
    .sort((a, b) => compare(b.timestamp, a.timestamp));
}

export function tallyCaughtBy(entries: readonly FrictionEntry[]): { who: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const who = entry.caughtBy.trim().toLowerCase() || 'unknown';
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  return [...counts].map(([who, count]) => ({ who, count })).sort((a, b) => b.count - a.count || compare(a.who, b.who));
}
