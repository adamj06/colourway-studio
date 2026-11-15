// V&A IIIF image base URLs look like https://framemark.vam.ac.uk/collections/2020MN1492/. They arrive inside
// V&A responses, so they are untrusted data: only this exact shape is ever turned into an <img> src.
const IIIF_BASE = /^https:\/\/framemark\.vam\.ac\.uk\/collections\/[A-Za-z0-9_-]+\/$/;
const MAX_SIZE = 4000;

export function isValidIiifBase(baseUrl: string): boolean {
  return IIIF_BASE.test(baseUrl);
}

function assertSize(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SIZE) {
    throw new RangeError(`IIIF ${label} must be an integer from 1 to ${String(MAX_SIZE)}`);
  }
}

/** Best-fit ("!w,h") full-region JPEG of an image, scaled by the IIIF server so the browser downloads only what it shows. */
export function iiifImageUrl(baseUrl: string, maxWidth: number, maxHeight: number): string {
  if (!isValidIiifBase(baseUrl)) throw new TypeError('Not a framemark IIIF image base URL');
  assertSize(maxWidth, 'width');
  assertSize(maxHeight, 'height');
  return `${baseUrl}full/!${String(maxWidth)},${String(maxHeight)}/0/default.jpg`;
}
