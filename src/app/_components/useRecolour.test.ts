import { describe, expect, it, vi } from 'vitest';
import type { Frame } from './recolourClient';
import { isSettled } from './useRecolour';

// useRecolour pulls in the worker client; this file only tests the pure helper.
vi.mock('./recolourClient', () => ({ createRecolourClient: vi.fn(), labOfHex: vi.fn() }));

const frame = { width: 1, height: 1 } as unknown as Frame;
const TAG = '0:#AABBCC|#112233';

describe('isSettled', () => {
  it('is false when there is no outcome yet', () => {
    expect(isSettled(null, TAG)).toBe(false);
  });

  it('is false for a preview frame, even for the current tag', () => {
    expect(isSettled({ tag: TAG, frame, final: false }, TAG)).toBe(false);
  });

  it('is true for the full-quality frame of the current tag', () => {
    expect(isSettled({ tag: TAG, frame, final: true }, TAG)).toBe(true);
  });

  it('is false for an old full-quality frame still on screen after the targets changed', () => {
    expect(isSettled({ tag: '0:#AABBCC|#445566', frame, final: true }, TAG)).toBe(false);
  });

  it('is false for a failed outcome (no frame) even if it is marked final', () => {
    expect(isSettled({ tag: TAG, frame: null, final: true }, TAG)).toBe(false);
  });
});
