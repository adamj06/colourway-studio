import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'vam');

/** Reads a captured V&A response from tests/fixtures/vam as parsed JSON. */
export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as unknown;
}

export const SEARCH_FIXTURES = [
  'search-dearle-org-A1365-images-p1.json',
  'search-empty-result.json',
  'search-morris-wallpaper.json',
  'search-org-A1365-AND-person-A8676-images-p1.json',
  'search-org-A1365-images-category-THES48878-p1.json',
  'search-org-A1365-images-p1.json',
  'search-org-A1365-images-q-strawberry-p1.json',
  'search-org-A1365-images-wallpaper-q_object_type-p1.json',
  'search-org-A1365-noimages-p2-size100.json',
  'search-person-A8676-images-p1.json',
];

export const OBJECT_FIXTURES = [
  'museumobject-O248458.json',
  'museumobject-O78207.json',
  'museumobject-O78220.json',
  'object-dearle-O78101.json',
  'object-no-images-O270961.json',
];

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
