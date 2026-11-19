import { describe, expect, it } from 'vitest';

import { formatCount, formatUsd } from './format';

describe('formatUsd', () => {
  it('always shows two decimals with a dollar sign', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(15.02)).toBe('$15.02');
    expect(formatUsd(3.5)).toBe('$3.50');
  });

  it('groups thousands', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });
});

describe('formatCount', () => {
  it('groups thousands with commas', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(20033917)).toBe('20,033,917');
  });
});
