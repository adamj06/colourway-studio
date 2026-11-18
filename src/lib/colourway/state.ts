// The colourway: which palette swatches the user has changed, and to what. Pure reducer, no DOM.
// Shaped so a later feature can serialise `edits` into the URL.
export type ColourwayState = {
  readonly original: readonly string[];
  readonly edits: Readonly<Record<number, string>>;
};

export type ColourwayAction =
  | { type: 'set'; index: number; hex: string }
  | { type: 'reset'; index: number }
  | { type: 'resetAll' }
  | { type: 'paletteChanged'; hexes: readonly string[] };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function initialColourway(original: readonly string[]): ColourwayState {
  return { original: [...original], edits: {} };
}

function validIndex(state: ColourwayState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < state.original.length;
}

function without(edits: Readonly<Record<number, string>>, index: number): Record<number, string> {
  return Object.fromEntries(Object.entries(edits).filter(([key]) => Number(key) !== index));
}

function setColour(state: ColourwayState, index: number, hex: string): ColourwayState {
  if (!validIndex(state, index) || !HEX.test(hex)) return state;
  const upper = hex.toUpperCase();
  if (upper === state.original[index]?.toUpperCase()) return { ...state, edits: without(state.edits, index) };
  return { ...state, edits: { ...state.edits, [index]: upper } };
}

export function colourwayReducer(state: ColourwayState, action: ColourwayAction): ColourwayState {
  switch (action.type) {
    case 'set':
      return setColour(state, action.index, action.hex);
    case 'reset':
      return validIndex(state, action.index) ? { ...state, edits: without(state.edits, action.index) } : state;
    case 'resetAll':
      return { ...state, edits: {} };
    case 'paletteChanged':
      return initialColourway(action.hexes);
  }
}

/** The colour every swatch should have now: the edit if there is one, otherwise the original. */
export function selectTargets(state: ColourwayState): string[] {
  return state.original.map((hex, index) => state.edits[index] ?? hex);
}

export function selectHasEdits(state: ColourwayState): boolean {
  return Object.keys(state.edits).length > 0;
}
