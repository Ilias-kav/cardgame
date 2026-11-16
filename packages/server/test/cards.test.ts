import { starterCatalog } from '@cardgame/engine';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, createTestApp, registerUser, resetDb } from './helpers.js';

describe('GET /api/cards', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  it('requires login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cards' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the whole catalog, sorted by id', async () => {
    const sid = await registerUser(app);
    const res = await as(app, sid)('GET', '/api/cards');
    expect(res.statusCode).toBe(200);
    const list = res.json().cards as Array<{ id: string; name: string; kind: string }>;
    expect(list).toHaveLength(Object.keys(starterCatalog).length);
    expect(list.map((c) => c.id)).toEqual([...list.map((c) => c.id)].sort());
    const ember = list.find((c) => c.id === 'embercub');
    expect(ember).toMatchObject({ name: 'Embercub', kind: 'creature' });
  });
});
