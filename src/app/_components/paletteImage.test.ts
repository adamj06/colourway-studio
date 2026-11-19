import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_MAX_SIDE, snapshotImage } from './paletteImage';

const IMG = { naturalWidth: 1200, naturalHeight: 600 } as HTMLImageElement;

/** A document whose canvas hands back this context (or none), recording the size it was given. */
function stubDocument(context: unknown) {
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  return canvas;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('snapshotImage', () => {
  it('prefers a downscaled bitmap when the browser can make one', async () => {
    const bitmap = {} as ImageBitmap;
    const create = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', create);
    vi.stubGlobal('OffscreenCanvas', vi.fn());

    await expect(snapshotImage(IMG)).resolves.toEqual({ kind: 'bitmap', bitmap });
    expect(create).toHaveBeenCalledWith(IMG, {
      resizeWidth: ANALYSIS_MAX_SIDE,
      resizeHeight: 300,
      resizeQuality: 'high',
    });
  });

  it('falls back to pixels when the bitmap call rejects', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
    vi.stubGlobal('OffscreenCanvas', vi.fn());
    const data = new Uint8ClampedArray(4);
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })) };
    const canvas = stubDocument(context);

    await expect(snapshotImage(IMG)).resolves.toEqual({ kind: 'pixels', image: { width: 600, height: 300, data } });
    expect(canvas).toMatchObject({ width: 600, height: 300 });
    expect(context.drawImage).toHaveBeenCalledWith(IMG, 0, 0, 600, 300);
  });

  it('draws to pixels at the requested size when there is no OffscreenCanvas', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('OffscreenCanvas', undefined);
    const data = new Uint8ClampedArray(4);
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })) };
    stubDocument(context);

    await expect(snapshotImage(IMG, 100)).resolves.toEqual({ kind: 'pixels', image: { width: 100, height: 50, data } });
  });

  it('throws when there is no 2d context, rather than analysing a blank canvas', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    stubDocument(null);

    await expect(snapshotImage(IMG)).rejects.toThrow('No 2d canvas context.');
  });
});
