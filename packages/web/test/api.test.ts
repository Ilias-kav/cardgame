import { describe, expect, it } from 'vitest';
import { ApiError, createApi } from '../src/api.js';

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no response queued');
    if (next instanceof Error) throw next;
    return new Response(next.status === 204 ? null : JSON.stringify(next.body ?? {}), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fn, calls };
}

describe('createApi', () => {
  it('login posts JSON and returns the user', async () => {
    const f = fakeFetch([{ status: 200, body: { user: { id: 'u1', username: 'alice' } } }]);
    const user = await createApi(f.fn).login('alice', 'pw');
    expect(user).toEqual({ id: 'u1', username: 'alice' });
    expect(f.calls[0]!.url).toBe('/api/auth/login');
    expect(f.calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ username: 'alice', password: 'pw' });
  });

  it('me() returns null for 401 and throws for other failures', async () => {
    const api1 = createApi(fakeFetch([{ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'no' } } }]).fn);
    expect(await api1.me()).toBeNull();
    const api2 = createApi(fakeFetch([{ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'boom' } } }]).fn);
    await expect(api2.me()).rejects.toThrow('boom');
  });

  it('turns error responses into ApiError with status, code and details', async () => {
    const api = createApi(
      fakeFetch([{ status: 400, body: { error: { code: 'DECK_INVALID', message: 'not valid', details: [{ code: 'WRONG_SIZE' }] } } }]).fn,
    );
    const err = await api.createGame('d1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'DECK_INVALID', message: 'not valid', details: [{ code: 'WRONG_SIZE' }] });
  });

  it('reports an unreachable server as a NETWORK error', async () => {
    const err = await createApi(fakeFetch([new TypeError('failed to fetch')]).fn).cards().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('handles 204 responses and encodes ids', async () => {
    const f = fakeFetch([{ status: 204 }]);
    expect(await createApi(f.fn).deleteDeck('a b/c')).toBeUndefined();
    expect(f.calls[0]!.url).toBe('/api/decks/a%20b%2Fc');
    expect(f.calls[0]!.init!.method).toBe('DELETE');
  });

  it('only sends cardId and count when saving decks', async () => {
    const f = fakeFetch([{ status: 201, body: { deck: { id: 'd' } } }]);
    await createApi(f.fn).createDeck('Mine', [{ cardId: 'embercub', count: 4, extra: 1 } as never]);
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ name: 'Mine', cards: [{ cardId: 'embercub', count: 4 }] });
  });
});
