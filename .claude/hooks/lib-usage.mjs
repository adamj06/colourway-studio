// Shared helpers for reading token usage from Claude Code transcripts and the cost ledger.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function readJson(p, fallback = {}) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseLine(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The { model, u } record for an assistant entry that carries usage, otherwise null. */
function usageRecord(entry) {
  const m = entry?.message;
  if (entry?.type !== 'assistant' || !m?.usage || !m.model) return null;
  return { id: m.id, rec: { model: m.model, u: m.usage } };
}

/** Usage per assistant message, deduped by message id. Returns { messages, last }. */
export function transcriptUsage(transcriptPath) {
  const byId = new Map();
  let last = null;
  if (!transcriptPath || !existsSync(transcriptPath)) return { messages: [], last };
  for (const line of readFileSync(transcriptPath, 'utf8').split(/\r?\n/)) {
    const entry = parseLine(line);
    const found = usageRecord(entry);
    if (!found) continue;
    byId.set(found.id ?? `n${byId.size}`, found.rec);
    if (!entry.isSidechain) last = found.rec;
  }
  return { messages: [...byId.values()], last };
}

/** Cache reads are billed at roughly a tenth of fresh input, so they count at that weight toward session limits. */
export const CACHE_READ_WEIGHT = 0.1;

/** Weighted tokens: input + output + cacheWrite + 0.1 x cacheRead. This is what the session limits measure. */
export function weightedTokens(u) {
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    CACHE_READ_WEIGHT * (u.cache_read_input_tokens ?? 0)
  );
}

/** Context currently in use = everything sent as input on the latest main-thread call. */
export function contextTokens(u) {
  if (!u) return 0;
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

/** USD estimate, or null if pricing for that model isn't filled in. */
export function estimateUsd(model, u, pricing) {
  const key = Object.keys(pricing).find((k) => !k.startsWith('_') && model.includes(k));
  const p = key ? pricing[key] : null;
  if (!p || p.input == null) return null;
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1e6
  );
}

/** Sum of est_usd in the ledger for today's date (UTC). */
export function ledgerUsdToday(root) {
  const ledger = path.join(root, 'docs/cost/ledger.csv');
  if (!existsSync(ledger)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  return readFileSync(ledger, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.startsWith(today))
    .reduce((sum, l) => sum + (parseFloat(l.split(',').at(-1)) || 0), 0);
}
