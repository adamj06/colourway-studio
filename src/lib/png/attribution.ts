import type { TextEntry } from './text-chunk';

/** The credit an exported PNG carries. ASCII only: tEXt is Latin-1 and must not contain curly quotes. */
export function exportTextEntries(systemNumber: string): TextEntry[] {
  return [
    { keyword: 'Source', text: `Victoria and Albert Museum, London (${systemNumber})` },
    { keyword: 'Software', text: 'Colourway Studio' },
  ];
}
