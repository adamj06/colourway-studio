import type { PaletteResponse } from './palette-protocol';

export function createPaletteHandler(_deps?: { yieldTick?: () => Promise<void> }): {
  handle(request: unknown, post: (response: PaletteResponse) => void): Promise<void>;
} {
  throw new Error('not implemented', { cause: [_deps] });
}
