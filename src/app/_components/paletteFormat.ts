/** "18%" for a share of 0.18; "<1%" for a real but tiny share, so a swatch never claims 0% of the design. */
export function formatShare(share: number): string {
  const percent = Math.round(share * 100);
  return percent === 0 && share > 0 ? '<1%' : `${String(percent)}%`;
}

/** Accessible name of a swatch button, e.g. "Colour 2 of 6, #5A6B3C, 18% of the design". */
export function swatchLabel(index: number, total: number, hex: string, share: number): string {
  return `Colour ${String(index + 1)} of ${String(total)}, ${hex}, ${formatShare(share)} of the design`;
}

/** Accessible name of a swatch's colour picker, e.g. "Colour 2 of 6, #5A6B3C, 18% of the design. Change colour". */
export function swatchPickerLabel(index: number, total: number, hex: string, share: number): string {
  return `${swatchLabel(index, total, hex, share)}. Change colour`;
}

export const changedMessage = (index: number, hex: string): string => `Colour ${String(index + 1)} changed to ${hex}`;
export const resetMessage = (index: number): string => `Colour ${String(index + 1)} reset`;
export const RESET_ALL_MESSAGE = 'All colours reset';
export const CLEARED_MESSAGE = 'Colour changes cleared';

export function coloursCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'colour' : 'colours'}`;
}

/** Shown when near-identical colours leave fewer swatches than the number asked for, even after topping up. */
export function fewerColoursMessage(count: number): string {
  return `This design only has ${String(count)} clearly different ${count === 1 ? 'colour' : 'colours'}.`;
}
