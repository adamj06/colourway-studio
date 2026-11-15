/** "18%" for a share of 0.18; "<1%" for a real but tiny share, so a swatch never claims 0% of the design. */
export function formatShare(share: number): string {
  const percent = Math.round(share * 100);
  return percent === 0 && share > 0 ? '<1%' : `${String(percent)}%`;
}

/** Accessible name of a swatch button, e.g. "Colour 2 of 6, #5A6B3C, 18% of the design". */
export function swatchLabel(index: number, total: number, hex: string, share: number): string {
  return `Colour ${String(index + 1)} of ${String(total)}, ${hex}, ${formatShare(share)} of the design`;
}

export function coloursCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'colour' : 'colours'}`;
}
