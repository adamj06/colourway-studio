import { isValidIiifBase } from './iiif';
import { objectResponseSchema, searchResponseSchema, type ObjectResponse, type SearchResponse } from './schemas';
import type { Design, DesignSummary, SearchResult } from './types';

export type { Design, DesignSummary, SearchResult } from './types';

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const untitled = (objectType: string | null): string => (objectType ? `Untitled ${objectType}` : 'Untitled');

// ---------- HTML to text (V&A descriptions contain <b>, <br> and entities) ----------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(match: string, body: string): string {
  const name = body.toLowerCase();
  // hasOwn, not a bare lookup: "&constructor;" must not resolve to Object.prototype.constructor.
  if (Object.hasOwn(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name] ?? match;
  const isHex = body[1] === 'x' || body[1] === 'X';
  const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

/**
 * Plain text from V&A HTML. Tags are removed (script and style with their content, an unterminated tag to the end),
 * `<br>` becomes a line break, and entities are decoded exactly once, after the tags are gone, so an encoded tag
 * stays text and can never become markup.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]*(?:>|$)/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => decodeEntity(match, body))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- search ----------

function mapSearchRecord(record: SearchResponse['records'][number]): DesignSummary | null {
  const imageBaseUrl = record._images?._iiif_image_base_url;
  if (!record._primaryImageId || !imageBaseUrl || !isValidIiifBase(imageBaseUrl)) return null;
  const objectType = clean(record.objectType);
  return {
    systemNumber: record.systemNumber,
    title: clean(record._primaryTitle) ?? untitled(objectType),
    designer: clean(record._primaryMaker?.name),
    date: clean(record._primaryDate),
    objectType: objectType ?? '',
    imageBaseUrl,
  };
}

/** Parses a raw /v2/objects/search body. Throws (ZodError) when it isn't the expected shape. */
export function mapSearchResponse(raw: unknown): SearchResult {
  const parsed = searchResponseSchema.parse(raw);
  return {
    items: parsed.records.map(mapSearchRecord).filter((item): item is DesignSummary => item !== null),
    page: parsed.info.page,
    totalPages: parsed.info.pages,
    total: parsed.info.record_count,
  };
}

// ---------- object ----------

type Maker = ObjectResponse['record']['artistMakerPerson'][number];

// The V&A spells roles inconsistently: designer/designers, Manufacturer/manufacturers.
const roleOf = (maker: Maker): string => (clean(maker.association?.text) ?? '').toLowerCase().replace(/s$/, '');

function namesWithRole(makers: Maker[], role: string): string[] {
  const names = makers.filter((m) => roleOf(m) === role).map((m) => clean(m.name?.text));
  return [...new Set(names.filter((name): name is string => name !== null))];
}

function formatDimensions(dimensions: ObjectResponse['record']['dimensions']): string | null {
  const parts = dimensions
    .map((d) => [clean(d.dimension), clean(d.value), clean(d.unit)].filter(Boolean).join(' '))
    .filter((part) => part !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

function descriptionOf(summary: string | null | undefined): string | null {
  return summary ? clean(htmlToText(summary)) : null;
}

function usableImageBase(parsed: ObjectResponse): string | null {
  const base = parsed.meta.images?._iiif_image;
  if (parsed.record.images.length === 0 || !base || !isValidIiifBase(base)) return null;
  return base;
}

/**
 * Parses a raw /v2/object/<id> body. Returns null for a design without a usable image (the app only shows
 * designs with images). Throws (ZodError) when it isn't the expected shape.
 */
export function mapObjectResponse(raw: unknown): Design | null {
  const parsed = objectResponseSchema.parse(raw);
  const imageBaseUrl = usableImageBase(parsed);
  if (imageBaseUrl === null) return null;

  const { meta, record } = parsed;
  const makers = [...record.artistMakerPerson, ...record.artistMakerOrganisations];
  const objectType = clean(record.objectType);
  return {
    systemNumber: record.systemNumber,
    title: clean(record.titles[0]?.title) ?? untitled(objectType),
    designers: namesWithRole(makers, 'designer'),
    manufacturers: namesWithRole(makers, 'manufacturer'),
    date: clean(record.productionDates[0]?.date?.text),
    objectType: objectType ?? '',
    materials: clean(record.materialsAndTechniques),
    dimensions: formatDimensions(record.dimensions),
    description: descriptionOf(record.summaryDescription),
    imageBaseUrl,
    creditLine: clean(record.creditLine),
    collectionUrl: clean(meta._links?.collection_page?.href),
  };
}
