import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lab } from '@/lib/colour/types';
import { snapshotImage, type Snapshot } from './paletteImage';
import { createRecolourClient, SETTLE_MS, type RecolourRequest } from './recolourClient';

vi.mock('./paletteImage', () => ({ snapshotImage: vi.fn() }));

class FakeWorker {
  static last: FakeWorker | null = null;
  posted: Record<string, unknown>[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  /** The recolour requests sent so far (the prepare message is not one of them). */
  recolours(): Record<string, unknown>[] {
    return this.posted.filter((message) => message.type === 'recolour');
  }
}

const SNAPSHOT: Snapshot = { kind: 'pixels', image: { width: 1, height: 1, data: new Uint8ClampedArray(4) } };
const IMAGE = {} as HTMLImageElement;
const SOURCES: Lab[] = [[50, 10, 10]];
const request = (tag: string): RecolourRequest => ({ targets: [[60, 5, 5]], tag });
const image = (id: number) => ({ type: 'image', id, width: 1, height: 1, data: new Uint8ClampedArray(4) });

function worker(): FakeWorker {
  if (FakeWorker.last === null) throw new Error('no worker was created');
  return FakeWorker.last;
}

/** A client whose worker has been prepared (the first request is already in flight). */
async function readyClient(first = request('a')) {
  const onResult = vi.fn();
  const client = createRecolourClient(IMAGE, SOURCES, first, onResult);
  await vi.advanceTimersByTimeAsync(0);
  return { client, onResult };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.last = null;
  vi.stubGlobal('Worker', FakeWorker);
  vi.mocked(snapshotImage).mockResolvedValue(SNAPSHOT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('createRecolourClient: one request at a time', () => {
  it('sends the first request as a preview once the worker is prepared', async () => {
    await readyClient();
    expect(worker().posted[0]).toMatchObject({ type: 'prepare', id: 0 });
    expect(worker().recolours()).toEqual([expect.objectContaining({ id: 1, quality: 'preview' })]);
  });

  it('holds newer changes while a request is running and sends only the newest after the answer', async () => {
    const { client } = await readyClient();
    client.request(request('b'));
    client.request(request('c'));
    expect(worker().recolours()).toHaveLength(1);

    worker().emit(image(1));
    expect(worker().recolours()).toHaveLength(2);
    expect(worker().recolours()[1]).toMatchObject({ id: 2, quality: 'preview' });
  });

  it('draws the answer for the request that ran even though newer changes arrived meanwhile (a drag paints)', async () => {
    const { client, onResult } = await readyClient();
    for (const tag of ['b', 'c', 'd']) client.request(request(tag));

    worker().emit(image(1));
    expect(onResult).toHaveBeenCalledExactlyOnceWith('a', expect.objectContaining({ width: 1 }), false);

    worker().emit(image(2));
    expect(onResult).toHaveBeenLastCalledWith('d', expect.objectContaining({ width: 1 }), false);
  });

  it('ignores an answer that does not belong to the request in flight', async () => {
    const { onResult } = await readyClient();
    worker().emit(image(99));
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('createRecolourClient: preview then final', () => {
  it('asks for a final frame once the targets have been unchanged for the settle time', async () => {
    await readyClient();
    worker().emit(image(1));
    expect(worker().recolours()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(worker().recolours()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(worker().recolours()).toHaveLength(2);
    expect(worker().recolours()[1]).toMatchObject({ quality: 'final' });
  });

  it('restarts the settle time on every change', async () => {
    const { client } = await readyClient();
    worker().emit(image(1));
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 10);
    client.request(request('b'));
    worker().emit(image(2));
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 10);
    expect(
      worker()
        .recolours()
        .filter((m) => m.quality === 'final'),
    ).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(
      worker()
        .recolours()
        .filter((m) => m.quality === 'final'),
    ).toHaveLength(1);
  });

  it('marks a frame final only when it answers the full-quality request', async () => {
    const { onResult } = await readyClient();
    worker().emit(image(1));
    expect(onResult).toHaveBeenLastCalledWith('a', expect.objectContaining({ width: 1 }), false);

    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    worker().emit(image(2));
    expect(onResult).toHaveBeenLastCalledWith('a', expect.objectContaining({ width: 1 }), true);
  });

  it('waits for a slow preview before sending the final, and draws both', async () => {
    const { onResult } = await readyClient();
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(worker().recolours()).toHaveLength(1);

    worker().emit(image(1));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(worker().recolours()[1]).toMatchObject({ id: 2, quality: 'final' });
    worker().emit(image(2));
    expect(onResult).toHaveBeenCalledTimes(2);
  });
});

describe('createRecolourClient: failures and disposal', () => {
  it('reports a failed prepare (an error answering id 0) as a failure, and later requests fail at once', async () => {
    const { client, onResult } = await readyClient();
    worker().emit({ type: 'error', id: 0, message: 'Could not read the image.' });
    expect(onResult).toHaveBeenCalledExactlyOnceWith('a', null, false);
    expect(worker().terminated).toBe(true);

    client.request(request('b'));
    expect(onResult).toHaveBeenLastCalledWith('b', null, false);
  });

  it('reports an error answering the request in flight as a failed frame', async () => {
    const { onResult } = await readyClient();
    worker().emit({ type: 'error', id: 1, message: 'Recolouring failed.' });
    expect(onResult).toHaveBeenCalledExactlyOnceWith('a', null, false);
  });

  it('sends and reports nothing after dispose, and stops the worker', async () => {
    const { client, onResult } = await readyClient();
    client.dispose();
    worker().emit(image(1));
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(onResult).not.toHaveBeenCalled();
    expect(worker().recolours()).toHaveLength(1);
    expect(worker().terminated).toBe(true);
  });

  it('sends nothing if it was disposed before the snapshot was ready', async () => {
    const onResult = vi.fn();
    const client = createRecolourClient(IMAGE, SOURCES, request('a'), onResult);
    client.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(worker().posted).toEqual([]);
  });
});
