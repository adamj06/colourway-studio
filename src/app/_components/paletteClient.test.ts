import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaletteClient } from './paletteClient';
import { postSnapshot, snapshotImage, type Snapshot } from './paletteImage';

vi.mock('./paletteImage', () => ({ snapshotImage: vi.fn(), postSnapshot: vi.fn() }));

class FakeWorker {
  static last: FakeWorker | null = null;
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

const SNAPSHOT: Snapshot = { kind: 'pixels', image: { width: 1, height: 1, data: new Uint8ClampedArray(4) } };
const IMAGE = {} as HTMLImageElement;
const SWATCHES = [{ hex: '#AABBCC', lab: [10, 20, 30] as [number, number, number], share: 1 }];
const palette = (id: number, k = 6) => ({ type: 'palette', id, k, swatches: SWATCHES });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function worker(): FakeWorker {
  if (FakeWorker.last === null) throw new Error('no worker was created');
  return FakeWorker.last;
}

beforeEach(() => {
  FakeWorker.last = null;
  vi.stubGlobal('Worker', FakeWorker);
  vi.mocked(snapshotImage).mockResolvedValue(SNAPSHOT);
  // Stands in for the real transfer: records which id and k the first (analyse) request carried.
  vi.mocked(postSnapshot).mockImplementation((target, _snapshot, id, k) => {
    target.postMessage({ type: 'analyse', id, k });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('createPaletteClient', () => {
  it('sends the first request once the image snapshot is ready, and reports the answer with its tag', async () => {
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();

    expect(worker().posted).toEqual([{ type: 'analyse', id: 0, k: 6 }]);
    worker().emit(palette(0));
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:6', SWATCHES);
  });

  it('does not send anything before the snapshot is ready', () => {
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, vi.fn());
    expect(worker().posted).toEqual([]);
  });

  it('uses the latest k when it changed before the snapshot was ready', async () => {
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, vi.fn());
    client.request({ k: 4, tag: '0:4' });
    await flush();

    expect(worker().posted).toEqual([{ type: 'analyse', id: 0, k: 4 }]);
  });

  it('asks for a new k with set-k and a fresh id once the image has been analysed', async () => {
    const onResult = vi.fn();
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    client.request({ k: 4, tag: '0:4' });

    expect(worker().posted).toEqual([
      { type: 'analyse', id: 0, k: 6 },
      { type: 'set-k', id: 1, k: 4 },
    ]);
    worker().emit(palette(1, 4));
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:4', SWATCHES);
  });

  it('ignores a late answer to a superseded request', async () => {
    const onResult = vi.fn();
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    client.request({ k: 5, tag: '0:5' });
    client.request({ k: 4, tag: '0:4' });

    worker().emit(palette(0));
    worker().emit(palette(1, 5));
    expect(onResult).not.toHaveBeenCalled();

    worker().emit(palette(2, 4));
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:4', SWATCHES);
  });

  it('ignores an answer for an id it never sent', async () => {
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    worker().emit(palette(99));
    expect(onResult).not.toHaveBeenCalled();
  });

  it('reports a failure (null swatches) for an error response from the worker', async () => {
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    worker().emit({ type: 'error', id: 0, message: 'boom' });
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:6', null);
  });

  it('reports a failure for a response that does not match the protocol', async () => {
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    worker().emit({ type: 'palette', id: 0, k: 6, swatches: [{ hex: 'red' }] });
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:6', null);
  });

  it('reports a failure when the worker itself errors, tagged with the latest request', async () => {
    const onResult = vi.fn();
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    client.request({ k: 4, tag: '0:4' });
    worker().onerror?.();
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:4', null);
  });

  it('reports a failure when the image cannot be read', async () => {
    vi.mocked(snapshotImage).mockRejectedValue(new Error('tainted'));
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:6', null);
    expect(worker().posted).toEqual([]);
  });

  it('terminates the worker on dispose and then stays silent', async () => {
    const onResult = vi.fn();
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    client.dispose();

    expect(worker().terminated).toBe(true);
    worker().emit(palette(0));
    worker().onerror?.();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('does not send the first request if it was disposed before the snapshot was ready', async () => {
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, vi.fn());
    client.dispose();
    await flush();
    expect(worker().posted).toEqual([]);
  });
});

describe('createPaletteClient after a failure', () => {
  it('answers later k changes with the failure at once, instead of waiting forever', async () => {
    vi.mocked(snapshotImage).mockRejectedValue(new Error('tainted'));
    const onResult = vi.fn();
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    client.request({ k: 5, tag: '0:5' });

    expect(onResult).toHaveBeenNthCalledWith(1, '0:6', null);
    expect(onResult).toHaveBeenNthCalledWith(2, '0:5', null);
    expect(worker().posted).toEqual([]);
  });

  it('does not post to a worker that has errored after the image was analysed', async () => {
    const onResult = vi.fn();
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    worker().onerror?.();
    client.request({ k: 4, tag: '0:4' });

    expect(onResult).toHaveBeenLastCalledWith('0:4', null);
    expect(worker().posted).toEqual([{ type: 'analyse', id: 0, k: 6 }]);
    expect(worker().terminated).toBe(true);
  });

  it('treats an error response with no request id as a failure of the newest request', async () => {
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    worker().emit({ type: 'error', id: null, message: 'bad request' });
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:6', null);
  });

  it('treats an undeliverable message as a failure', async () => {
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    worker().onmessageerror?.();
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:6', null);
  });

  it('stays silent after dispose even when a request arrives', async () => {
    vi.mocked(snapshotImage).mockRejectedValue(new Error('tainted'));
    const onResult = vi.fn();
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    onResult.mockClear();
    client.dispose();
    client.request({ k: 5, tag: '0:5' });
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('createPaletteClient and ImageBitmap ownership', () => {
  const bitmap = () => ({ close: vi.fn() });

  it('closes a bitmap that resolved after the client was disposed', async () => {
    const owned = bitmap();
    vi.mocked(snapshotImage).mockResolvedValue({ kind: 'bitmap', bitmap: owned as unknown as ImageBitmap });
    const client = createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, vi.fn());
    client.dispose();
    await flush();
    expect(owned.close).toHaveBeenCalledOnce();
    expect(postSnapshot).not.toHaveBeenCalled();
  });

  it('closes the bitmap and reports a failure when posting it throws', async () => {
    const owned = bitmap();
    vi.mocked(snapshotImage).mockResolvedValue({ kind: 'bitmap', bitmap: owned as unknown as ImageBitmap });
    vi.mocked(postSnapshot).mockImplementation(() => {
      throw new Error('DataCloneError');
    });
    const onResult = vi.fn();
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, onResult);
    await flush();
    expect(owned.close).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledExactlyOnceWith('0:6', null);
  });

  it('does not close a bitmap that was handed over to the worker', async () => {
    const owned = bitmap();
    vi.mocked(snapshotImage).mockResolvedValue({ kind: 'bitmap', bitmap: owned as unknown as ImageBitmap });
    createPaletteClient(IMAGE, { k: 6, tag: '0:6' }, vi.fn());
    await flush();
    expect(owned.close).not.toHaveBeenCalled();
    expect(postSnapshot).toHaveBeenCalledOnce();
  });
});
