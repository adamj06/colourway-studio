// Checks for identifiers and links that arrive inside V&A responses (untrusted data).

const SYSTEM_NUMBER = /^O\d{1,10}$/;

export const isSystemNumber = (value: string): boolean => SYSTEM_NUMBER.test(value);

/** The V&A's own public collection page for an object. Anything else is dropped, so a poisoned field can't link out. */
export function isCollectionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.hostname === 'collections.vam.ac.uk' && url.username === '' && url.port === ''
    );
  } catch {
    return false;
  }
}
