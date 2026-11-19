import { describe, expect, it } from 'vitest';
import {
  changedMessage,
  CLEARED_MESSAGE,
  coloursCount,
  formatShare,
  RESET_ALL_MESSAGE,
  resetMessage,
  swatchLabel,
  swatchPickerLabel,
} from './paletteFormat';

describe('recolour messages', () => {
  it('names the picker after the swatch and the action', () => {
    expect(swatchPickerLabel(1, 6, '#5A6B3C', 0.18)).toBe('Colour 2 of 6, #5A6B3C, 18% of the design. Change colour');
  });

  it('announces a changed colour by its one-based number', () => {
    expect(changedMessage(1, '#112233')).toBe('Colour 2 changed to #112233');
  });

  it('announces a reset colour, a reset of everything, and cleared edits', () => {
    expect(resetMessage(0)).toBe('Colour 1 reset');
    expect(RESET_ALL_MESSAGE).toBe('All colours reset');
    expect(CLEARED_MESSAGE).toBe('Colour changes cleared');
  });
});

describe('formatShare', () => {
  it.each([
    [0.18, '18%'],
    [0.5, '50%'],
    [1, '100%'],
    [0.004, '<1%'],
    [0.005, '1%'],
    [0, '0%'],
  ])('formats %s as %s', (share, expected) => {
    expect(formatShare(share)).toBe(expected);
  });
});

describe('swatchLabel', () => {
  it('names the swatch position, hex and share', () => {
    expect(swatchLabel(1, 6, '#5A6B3C', 0.18)).toBe('Colour 2 of 6, #5A6B3C, 18% of the design');
  });
});

describe('coloursCount', () => {
  it('pluralises', () => {
    expect(coloursCount(1)).toBe('1 colour');
    expect(coloursCount(2)).toBe('2 colours');
    expect(coloursCount(6)).toBe('6 colours');
  });
});
