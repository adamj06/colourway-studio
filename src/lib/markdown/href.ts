import { group } from '../text/safe';

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** Characters a link destination must never contain: whitespace, controls, invisibles, backslash. */
function isUnsafeChar(code: number): boolean {
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0xa0) ||
    code === 0x5c || // backslash: browsers read `/\host` as protocol-relative
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0xfeff
  );
}

function hasUnsafeChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (isUnsafeChar(s.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * Link allowlist: http(s), `#fragment`, and relative paths. Everything else (javascript:, data:,
 * vbscript:, mailto:, file:, protocol-relative `//host`, and anything hiding a scheme behind
 * whitespace or control characters) is refused.
 */
export function isSafeHref(href: string): boolean {
  if (href === '' || hasUnsafeChar(href)) return false;
  if (href.startsWith('#')) return true;
  if (href.startsWith('//')) return false;
  const scheme = group(SCHEME.exec(href), 1).toLowerCase();
  if (scheme === '') return true;
  return (scheme === 'http' || scheme === 'https') && isPlainWebUrl(href);
}

/** An absolute web link must parse and carry no `user:pass@` credentials (a phishing shape). */
function isPlainWebUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
