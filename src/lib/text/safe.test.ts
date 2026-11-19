import { describe, expect, it } from 'vitest';

import { at, group } from './safe';

describe('at', () => {
  it('returns the item at an index', () => {
    expect(at(['a', 'b'], 1)).toBe('b');
  });

  it('returns an empty string out of range, negative or on an empty list', () => {
    expect(at(['a'], 1)).toBe('');
    expect(at(['a'], -1)).toBe('');
    expect(at([], 0)).toBe('');
  });
});

describe('group', () => {
  it('returns a captured group', () => {
    expect(group(/(a)(b)/.exec('ab'), 2)).toBe('b');
    expect(group(/(a)(b)/.exec('ab'), 0)).toBe('ab');
  });

  it('returns an empty string for a group that did not take part in the match', () => {
    expect(group(/(a)|(b)/.exec('a'), 2)).toBe('');
  });

  it('returns an empty string for no match or a missing group', () => {
    expect(group(null, 1)).toBe('');
    expect(group(undefined, 1)).toBe('');
    expect(group(/(a)/.exec('a'), 5)).toBe('');
  });
});
