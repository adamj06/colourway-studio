'use client';

import { useCallback, useReducer, useState } from 'react';
import {
  colourwayReducer,
  initialColourway,
  selectHasEdits,
  selectTargets,
  type ColourwayState,
} from '@/lib/colourway/state';
import type { Swatch } from '@/lib/colour/types';

export type ColourwayView = {
  /** The colour each swatch should have now: its edit, or its original. */
  targets: string[];
  originals: readonly string[];
  hasEdits: boolean;
  isEdited: (index: number) => boolean;
  set: (index: number, hex: string) => void;
  reset: (index: number) => void;
  resetAll: () => void;
  /** True while the user is looking at the untouched design instead of the recoloured one. */
  showOriginal: boolean;
  toggleOriginal: () => void;
};

const isEdited = (state: ColourwayState, index: number): boolean => index in state.edits;

/**
 * The user's colour changes for the current palette. A new palette (another k, a retry) discards them: the swatches
 * the edits pointed at no longer exist. The reset happens during render, so no frame ever shows edits against a
 * palette they do not belong to.
 */
export function useColourway(swatches: Swatch[]): ColourwayView {
  const hexes = swatches.map((swatch) => swatch.hex);
  const key = hexes.join(',');
  const [state, dispatch] = useReducer(colourwayReducer, hexes, initialColourway);
  const [seenKey, setSeenKey] = useState(key);
  const [showOriginal, setShowOriginal] = useState(false);
  if (seenKey !== key) {
    setSeenKey(key);
    setShowOriginal(false);
    dispatch({ type: 'paletteChanged', hexes });
  }

  const set = useCallback((index: number, hex: string) => {
    setShowOriginal(false);
    dispatch({ type: 'set', index, hex });
  }, []);
  const reset = useCallback((index: number) => {
    dispatch({ type: 'reset', index });
  }, []);
  const resetAll = useCallback(() => {
    setShowOriginal(false);
    dispatch({ type: 'resetAll' });
  }, []);
  const toggleOriginal = useCallback(() => {
    setShowOriginal((value) => !value);
  }, []);

  const hasEdits = selectHasEdits(state);
  return {
    targets: selectTargets(state),
    originals: state.original,
    hasEdits,
    isEdited: (index) => isEdited(state, index),
    set,
    reset,
    resetAll,
    showOriginal: showOriginal && hasEdits,
    toggleOriginal,
  };
}
