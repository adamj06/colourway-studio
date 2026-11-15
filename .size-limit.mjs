// First-load JS budget for `/` (docs/quality-gates.md, ADR 0004).
// Measures only the scripts the built home page references, so lazy-loaded chunks (palette worker,
// export code) do not count as first-load. Run `npm run build` first.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const htmlPath = path.join(root, '.next', 'server', 'app', 'index.html');

function firstLoadScripts() {
  if (!existsSync(htmlPath)) {
    throw new Error('size-limit: .next/server/app/index.html not found. Run `npm run build` first.');
  }
  const html = readFileSync(htmlPath, 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  const files = [...new Set(urls)].map((url) => path.posix.join('.next', url.replace('/_next/', '')));
  if (files.length === 0) {
    throw new Error('size-limit: found no scripts in the built home page, so the gate would measure nothing.');
  }
  return files;
}

const sizeLimitConfig = [
  {
    name: 'First-load JS for / (gzip)',
    path: firstLoadScripts(),
    gzip: true,
    limit: '200 kB',
  },
];

export default sizeLimitConfig;
