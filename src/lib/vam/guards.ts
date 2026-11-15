import { isValidIiifBase } from './iiif';
import { isCollectionUrl, isSystemNumber } from './urls';
import type { Design, DesignSummary, SearchResult } from './types';

// Runtime checks for the JSON our own /api/vam/* routes return, used by client components. Deliberately
// hand-written rather than zod: zod would add tens of kB to the first-load JS, which has ~20 kB of headroom
// (docs/adr/0004). The shapes are ours, so this guards against drift and corruption, not against hostile servers.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

const isCollectionUrlOrNull = (v: unknown): boolean => v === null || (isStr(v) && isCollectionUrl(v));
const isSysNum = (v: unknown): boolean => isStr(v) && isSystemNumber(v);

function isSummary(v: unknown): v is DesignSummary {
  return (
    isObj(v) &&
    isSysNum(v.systemNumber) &&
    isStr(v.title) &&
    isStrOrNull(v.designer) &&
    isStrOrNull(v.date) &&
    isStr(v.objectType) &&
    isStr(v.imageBaseUrl) &&
    isValidIiifBase(v.imageBaseUrl)
  );
}

export function isSearchResult(v: unknown): v is SearchResult {
  return (
    isObj(v) &&
    isCount(v.page) &&
    isCount(v.totalPages) &&
    isCount(v.total) &&
    Array.isArray(v.items) &&
    v.items.every(isSummary)
  );
}

function hasDesignIdentity(v: Obj): boolean {
  return (
    isSysNum(v.systemNumber) &&
    isStr(v.title) &&
    isStrArray(v.designers) &&
    isStrArray(v.manufacturers) &&
    isStr(v.objectType) &&
    isStrOrNull(v.date)
  );
}

function hasDesignDetails(v: Obj): boolean {
  return (
    isStrOrNull(v.materials) &&
    isStrOrNull(v.dimensions) &&
    isStrOrNull(v.description) &&
    isStrOrNull(v.creditLine) &&
    isCollectionUrlOrNull(v.collectionUrl) &&
    isStr(v.imageBaseUrl) &&
    isValidIiifBase(v.imageBaseUrl)
  );
}

export function isDesign(v: unknown): v is Design {
  return isObj(v) && hasDesignIdentity(v) && hasDesignDetails(v);
}
