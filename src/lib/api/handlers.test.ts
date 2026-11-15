import { describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../../../tests/helpers/fixtures';
import type { Design, SearchResult } from '../vam/map';
import { mapObjectResponse, mapSearchResponse } from '../vam/map';
import { VamError } from '../vam/client';
import { handleHealth, handleObject, handleSearch } from './handlers';

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function clock(...times: number[]) {
  const queue = [...times];
  return () => queue.shift() ?? times[times.length - 1]!;
}

const searchResult: SearchResult = mapSearchResponse(loadFixture('search-morris-wallpaper.json'));
const design = mapObjectResponse(loadFixture('museumobject-O78207.json')) as Design;

describe('handleSearch', () => {
  it('returns 400 with a typed error and never calls the client for bad params', async () => {
    const searchDesigns = vi.fn();
    const out = await handleSearch(new URLSearchParams('page=0'), {
      client: { searchDesigns },
      logger: fakeLogger(),
    });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ error: { code: 'invalid_input' } });
    expect(searchDesigns).not.toHaveBeenCalled();
  });

  it('returns 400 for a q longer than 100 characters', async () => {
    const searchDesigns = vi.fn();
    const out = await handleSearch(new URLSearchParams({ q: 'a'.repeat(101) }), {
      client: { searchDesigns },
      logger: fakeLogger(),
    });
    expect(out.status).toBe(400);
    expect(searchDesigns).not.toHaveBeenCalled();
  });

  it('calls the client with the parsed q and page and returns 200 with the result', async () => {
    const searchDesigns = vi.fn().mockResolvedValue(searchResult);
    const out = await handleSearch(new URLSearchParams('q=%20indian%20&page=2'), {
      client: { searchDesigns },
      logger: fakeLogger(),
    });
    expect(searchDesigns).toHaveBeenCalledWith({ q: 'indian', page: 2 });
    expect(out).toEqual({ status: 200, body: searchResult });
  });

  it('logs exactly one info line with status and durationMs from the injected clock', async () => {
    const logger = fakeLogger();
    await handleSearch(new URLSearchParams(''), {
      client: { searchDesigns: vi.fn().mockResolvedValue(searchResult) },
      logger,
      now: clock(1000, 1042),
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    const fields = logger.info.mock.calls[0]![1] as Record<string, unknown>;
    expect(fields).toMatchObject({ status: 200, durationMs: 42 });
  });

  it('never passes headers or bodies to the logger', async () => {
    const logger = fakeLogger();
    await handleSearch(new URLSearchParams('q=x'), {
      client: { searchDesigns: vi.fn().mockResolvedValue(searchResult) },
      logger,
    });
    const serialised = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(serialised).not.toMatch(/"(headers|body|cookie|authorization)"/i);
  });

  it.each([
    ['not_found', 404],
    ['timeout', 504],
    ['upstream', 502],
    ['invalid_response', 502],
  ] as const)('maps a VamError %s to HTTP %i and logs one error', async (code, status) => {
    const logger = fakeLogger();
    const out = await handleSearch(new URLSearchParams(''), {
      client: { searchDesigns: vi.fn().mockRejectedValue(new VamError(code, 'boom')) },
      logger,
    });
    expect(out.status).toBe(status);
    expect(out.body).toMatchObject({ error: { code } });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs upstreamStatus when the VamError carries one', async () => {
    const logger = fakeLogger();
    await handleSearch(new URLSearchParams(''), {
      client: { searchDesigns: vi.fn().mockRejectedValue(new VamError('upstream', 'boom', 503)) },
      logger,
      now: clock(0, 5),
    });
    const fields = logger.error.mock.calls[0]![1] as Record<string, unknown>;
    expect(fields).toMatchObject({ upstreamStatus: 503, durationMs: 5 });
  });

  it('returns a generic 500 and hides the message for an unexpected error', async () => {
    const out = await handleSearch(new URLSearchParams(''), {
      client: { searchDesigns: vi.fn().mockRejectedValue(new Error('secret sk-12345')) },
      logger: fakeLogger(),
    });
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.body)).not.toContain('sk-12345');
  });
});

describe('handleObject', () => {
  it('returns 400 and never calls the client for an invalid system number', async () => {
    const getDesign = vi.fn();
    const out = await handleObject('../objects/search', { client: { getDesign }, logger: fakeLogger() });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ error: { code: 'invalid_input' } });
    expect(getDesign).not.toHaveBeenCalled();
  });

  it('returns 200 with the design', async () => {
    const getDesign = vi.fn().mockResolvedValue(design);
    const out = await handleObject('O78207', { client: { getDesign }, logger: fakeLogger() });
    expect(getDesign).toHaveBeenCalledWith('O78207');
    expect(out).toEqual({ status: 200, body: design });
  });

  it('logs one info line with status and durationMs', async () => {
    const logger = fakeLogger();
    await handleObject('O78207', {
      client: { getDesign: vi.fn().mockResolvedValue(design) },
      logger,
      now: clock(10, 25),
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]![1]).toMatchObject({ status: 200, durationMs: 15 });
  });

  it('returns 404 for a not_found VamError', async () => {
    const logger = fakeLogger();
    const out = await handleObject('O99999999', {
      client: { getDesign: vi.fn().mockRejectedValue(new VamError('not_found', 'nope', 404)) },
      logger,
    });
    expect(out.status).toBe(404);
    expect(out.body).toMatchObject({ error: { code: 'not_found' } });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![1]).toMatchObject({ upstreamStatus: 404 });
  });

  it('returns 504 for a timeout', async () => {
    const out = await handleObject('O78207', {
      client: { getDesign: vi.fn().mockRejectedValue(new VamError('timeout', 'slow')) },
      logger: fakeLogger(),
    });
    expect(out.status).toBe(504);
  });
});

describe('handleHealth', () => {
  const checkedAt = '2026-11-15T12:00:00.000Z';
  const now = () => Date.parse(checkedAt);

  it('reports the version and V&A reachability with status 200', async () => {
    const ping = vi.fn().mockResolvedValue({ reachable: true, latencyMs: 87 });
    const out = await handleHealth({ client: { ping }, version: 'abc1234', now });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ version: 'abc1234', vam: { reachable: true, latencyMs: 87, checkedAt } });
  });

  it('falls back to "dev" when there is no version', async () => {
    const ping = vi.fn().mockResolvedValue({ reachable: true, latencyMs: 1 });
    const out = await handleHealth({ client: { ping }, version: undefined, now });
    expect(out.body).toMatchObject({ version: 'dev' });
  });

  it('still answers 200 when V&A is unreachable', async () => {
    const ping = vi.fn().mockResolvedValue({ reachable: false, latencyMs: 5000 });
    const out = await handleHealth({ client: { ping }, version: 'abc', now });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ vam: { reachable: false, latencyMs: 5000 } });
  });

  it('answers 200 with reachable false when ping itself throws', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('boom'));
    const out = await handleHealth({ client: { ping }, version: 'abc', now });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ vam: { reachable: false } });
  });

  it('produces an ISO 8601 checkedAt', async () => {
    const ping = vi.fn().mockResolvedValue({ reachable: true, latencyMs: 1 });
    const out = await handleHealth({ client: { ping }, version: 'abc' });
    const body = out.body as { vam: { checkedAt: string } };
    expect(body.vam.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});
