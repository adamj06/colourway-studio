import { describe, expect, it } from 'vitest';

import {
  colourwayReducer,
  initialColourway,
  selectHasEdits,
  selectTargets,
  type ColourwayAction,
  type ColourwayState,
} from './state';

const ORIGINAL = ['#C0392B', '#2E86C1', '#27AE60', '#F1C40F'];

/** Deep-freezes a state so any in-place mutation by the reducer throws. */
function frozen(state: ColourwayState): ColourwayState {
  Object.freeze(state.original);
  Object.freeze(state.edits);
  return Object.freeze(state);
}

function run(...actions: ColourwayAction[]): ColourwayState {
  return actions.reduce((state, action) => colourwayReducer(frozen(state), action), initialColourway(ORIGINAL));
}

const set = (index: number, hex: string): ColourwayAction => ({ type: 'set', index, hex });

describe('colourway state: initial', () => {
  it('starts with targets equal to the original palette and no edits', () => {
    const state = initialColourway(ORIGINAL);
    expect(selectTargets(state)).toEqual(ORIGINAL);
    expect(selectHasEdits(state)).toBe(false);
  });
});

describe('colourway state: set', () => {
  it('replaces one swatch and leaves the others', () => {
    const state = run(set(1, '#112233'));
    expect(selectTargets(state)).toEqual(['#C0392B', '#112233', '#27AE60', '#F1C40F']);
    expect(selectHasEdits(state)).toBe(true);
  });

  it('normalises a lowercase hex to uppercase', () => {
    expect(selectTargets(run(set(0, '#abcdef')))[0]).toBe('#ABCDEF');
  });

  it('keeps several edits at once and lets a later edit overwrite an earlier one', () => {
    const state = run(set(0, '#111111'), set(2, '#222222'), set(0, '#333333'));
    expect(selectTargets(state)).toEqual(['#333333', '#2E86C1', '#222222', '#F1C40F']);
  });

  it('removes the edit when a swatch is set back to its original hex', () => {
    const state = run(set(1, '#112233'), set(1, '#2E86C1'));
    expect(selectTargets(state)).toEqual(ORIGINAL);
    expect(selectHasEdits(state)).toBe(false);
  });

  it('treats the original hex case-insensitively when removing an edit', () => {
    const state = run(set(1, '#112233'), set(1, '#2e86c1'));
    expect(selectHasEdits(state)).toBe(false);
  });

  it('does not record an edit when a never-edited swatch is set to its own colour', () => {
    expect(selectHasEdits(run(set(0, '#C0392B')))).toBe(false);
  });

  it.each(['', 'red', '#FFF', '#12345', '#1234567', '123456', '#GGGGGG', '#12 456', ' #123456', '#123456 '])(
    'ignores the invalid hex %j and returns the same state',
    (hex) => {
      const before = initialColourway(ORIGINAL);
      expect(colourwayReducer(before, set(0, hex))).toBe(before);
    },
  );

  it.each([-1, 4, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores the invalid index %s and returns the same state',
    (index) => {
      const before = initialColourway(ORIGINAL);
      expect(colourwayReducer(before, set(index, '#112233'))).toBe(before);
    },
  );

  it('accepts the first and last valid index', () => {
    const state = run(set(0, '#111111'), set(3, '#222222'));
    expect(selectTargets(state)[0]).toBe('#111111');
    expect(selectTargets(state)[3]).toBe('#222222');
  });
});

describe('colourway state: reset', () => {
  it('puts one edited swatch back to its original and keeps other edits', () => {
    const state = run(set(0, '#111111'), set(1, '#222222'), { type: 'reset', index: 0 });
    expect(selectTargets(state)).toEqual(['#C0392B', '#222222', '#27AE60', '#F1C40F']);
    expect(selectHasEdits(state)).toBe(true);
  });

  it('clears hasEdits when the last edit is reset', () => {
    expect(selectHasEdits(run(set(0, '#111111'), { type: 'reset', index: 0 }))).toBe(false);
  });

  it('does nothing for a swatch that was not edited', () => {
    expect(selectTargets(run(set(0, '#111111'), { type: 'reset', index: 2 }))).toEqual([
      '#111111',
      '#2E86C1',
      '#27AE60',
      '#F1C40F',
    ]);
  });

  it.each([-1, 4, 0.5, Number.NaN])('ignores reset with the invalid index %s and returns the same state', (index) => {
    const before = colourwayReducer(initialColourway(ORIGINAL), set(0, '#111111'));
    expect(colourwayReducer(before, { type: 'reset', index })).toBe(before);
  });
});

describe('colourway state: resetAll', () => {
  it('removes every edit', () => {
    const state = run(set(0, '#111111'), set(3, '#222222'), { type: 'resetAll' });
    expect(selectTargets(state)).toEqual(ORIGINAL);
    expect(selectHasEdits(state)).toBe(false);
  });

  it('is harmless when there are no edits', () => {
    expect(selectTargets(run({ type: 'resetAll' }))).toEqual(ORIGINAL);
  });
});

describe('colourway state: paletteChanged', () => {
  const NEXT = ['#000000', '#FFFFFF', '#808080', '#FF0000', '#00FF00'];

  it('replaces the original palette and clears all edits', () => {
    const state = run(set(0, '#111111'), set(1, '#222222'), { type: 'paletteChanged', hexes: NEXT });
    expect(selectTargets(state)).toEqual(NEXT);
    expect(selectHasEdits(state)).toBe(false);
  });

  it('validates indexes against the new palette length', () => {
    const grown = run({ type: 'paletteChanged', hexes: NEXT }, set(4, '#123456'));
    expect(selectTargets(grown)[4]).toBe('#123456');
    const shrunk = run(
      { type: 'paletteChanged', hexes: ['#000000', '#FFFFFF', '#808080', '#FF0000'] },
      set(4, '#123456'),
    );
    expect(selectTargets(shrunk)).toHaveLength(4);
    expect(selectHasEdits(shrunk)).toBe(false);
  });

  it('compares later edits with the new original colours', () => {
    const state = run({ type: 'paletteChanged', hexes: NEXT }, set(0, '#C0392B'), set(1, '#FFFFFF'));
    expect(selectTargets(state)[0]).toBe('#C0392B');
    expect(selectTargets(state)[1]).toBe('#FFFFFF');
    expect(selectHasEdits(state)).toBe(true);
    expect(selectHasEdits(run({ type: 'paletteChanged', hexes: NEXT }, set(1, '#FFFFFF')))).toBe(false);
  });
});

describe('colourway state: purity', () => {
  it('never mutates the previous state', () => {
    const before = frozen(initialColourway(ORIGINAL));
    const snapshot = JSON.stringify(before);
    const actions: ColourwayAction[] = [
      set(0, '#111111'),
      { type: 'reset', index: 0 },
      { type: 'resetAll' },
      { type: 'paletteChanged', hexes: ['#000000'] },
      set(9, '#111111'),
      set(0, 'bad'),
    ];
    for (const action of actions) {
      expect(() => colourwayReducer(before, action)).not.toThrow();
    }
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('returns a state whose targets list is a fresh array each time', () => {
    const state = initialColourway(ORIGINAL);
    const targets = selectTargets(state);
    targets[0] = '#000000';
    expect(selectTargets(state)).toEqual(ORIGINAL);
  });

  it('does not let later changes to the input array alter the state', () => {
    const input = [...ORIGINAL];
    const state = initialColourway(input);
    input[0] = '#000000';
    expect(selectTargets(state)).toEqual(ORIGINAL);
  });
});
