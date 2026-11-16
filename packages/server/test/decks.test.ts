import { starterCatalog, starterDecks, type Card } from '@cardgame/engine';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { PASSWORD, as, createTestApp, registerUser, resetDb, sessionCookie } from './helpers.js';

const fireDeck = { name: 'Fire', cards: starterDecks.fire! };

describe('decks', () => {
  let app: FastifyInstance;
  let alice: ReturnType<typeof as>;
  let bob: ReturnType<typeof as>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    alice = as(app, await registerUser(app, 'alice'));
    bob = as(app, await registerUser(app, 'bob'));
  });

  it('requires login for every endpoint', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [method, url] of [
      ['GET', '/api/decks'],
      ['POST', '/api/decks'],
      ['GET', `/api/decks/${id}`],
      ['PUT', `/api/decks/${id}`],
      ['DELETE', `/api/decks/${id}`],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
  });

  describe('create and read', () => {
    it('stores a valid full deck and reports it valid', async () => {
      const res = await alice('POST', '/api/decks', fireDeck);
      expect(res.statusCode).toBe(201);
      const deck = res.json().deck;
      expect(deck).toMatchObject({ name: 'Fire', cardCount: 60, valid: true, errors: [] });

      const read = await alice('GET', `/api/decks/${deck.id}`);
      expect(read.statusCode).toBe(200);
      expect(read.json().deck.cards).toHaveLength(starterDecks.fire!.length);
      expect(read.json().deck.valid).toBe(true);
    });

    it('allows saving an unfinished deck as a draft, flagged invalid', async () => {
      const res = await alice('POST', '/api/decks', { name: 'WIP', cards: [{ cardId: 'embercub', count: 3 }] });
      expect(res.statusCode).toBe(201);
      expect(res.json().deck.valid).toBe(false);
      expect(res.json().deck.errors.map((e: { code: string }) => e.code)).toContain('WRONG_SIZE');
      const empty = await alice('POST', '/api/decks', { name: 'Empty', cards: [] });
      expect(empty.statusCode).toBe(201);
    });

    it('computes validity from the rules: too many copies is invalid', async () => {
      const res = await alice('POST', '/api/decks', {
        name: 'Greedy',
        cards: [
          { cardId: 'embercub', count: 5 },
          { cardId: 'power-fire', count: 55 },
        ],
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().deck.valid).toBe(false);
      expect(res.json().deck.errors[0].code).toBe('TOO_MANY_COPIES');
    });

    it('merges duplicate entries of the same card', async () => {
      const res = await alice('POST', '/api/decks', {
        name: 'Dupes',
        cards: [
          { cardId: 'embercub', count: 2 },
          { cardId: 'embercub', count: 2 },
        ],
      });
      expect(res.json().deck.cards).toEqual([{ cardId: 'embercub', count: 4 }]);
    });

    it('rejects unknown cards and bad counts with 400', async () => {
      const unknown = await alice('POST', '/api/decks', { name: 'X', cards: [{ cardId: 'ghost', count: 1 }] });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json().error.code).toBe('UNKNOWN_CARD');
      for (const count of [0, -2, 1.5]) {
        const res = await alice('POST', '/api/decks', { name: 'X', cards: [{ cardId: 'embercub', count }] });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('validates the name', async () => {
      for (const name of ['', '   ', 'x'.repeat(41)]) {
        expect((await alice('POST', '/api/decks', { name, cards: [] })).statusCode).toBe(400);
      }
    });

    it('limits each user to 20 decks', async () => {
      for (let i = 0; i < 20; i++) {
        expect((await alice('POST', '/api/decks', { name: `d${i}`, cards: [] })).statusCode).toBe(201);
      }
      const res = await alice('POST', '/api/decks', { name: 'one too many', cards: [] });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('DECK_LIMIT_REACHED');
      // Another user is unaffected.
      expect((await bob('POST', '/api/decks', { name: 'mine', cards: [] })).statusCode).toBe(201);
    });
  });

  describe('list', () => {
    it('lists only your own decks as summaries, newest change first', async () => {
      const first = (await alice('POST', '/api/decks', fireDeck)).json().deck;
      const second = (await alice('POST', '/api/decks', { name: 'WIP', cards: [] })).json().deck;
      await bob('POST', '/api/decks', { name: 'Bob deck', cards: [] });

      const res = await alice('GET', '/api/decks');
      const list = res.json().decks as Array<Record<string, unknown>>;
      expect(list.map((d) => d.id)).toEqual([second.id, first.id]);
      expect(list[1]).toMatchObject({ name: 'Fire', cardCount: 60, valid: true });
      expect(Object.keys(list[1]!).sort()).toEqual(['cardCount', 'id', 'name', 'updatedAt', 'valid']);
    });

    it('returns an empty list for a new user', async () => {
      expect((await alice('GET', '/api/decks')).json()).toEqual({ decks: [] });
    });
  });

  describe('update', () => {
    it('replaces name and cards completely', async () => {
      const id = (await alice('POST', '/api/decks', fireDeck)).json().deck.id;
      const res = await alice('PUT', `/api/decks/${id}`, {
        name: 'Renamed',
        cards: [{ cardId: 'pondling', count: 2 }],
      });
      expect(res.statusCode).toBe(200);
      const read = (await alice('GET', `/api/decks/${id}`)).json().deck;
      expect(read.name).toBe('Renamed');
      expect(read.cards).toEqual([{ cardId: 'pondling', count: 2 }]);
      expect(read.valid).toBe(false);
    });

    it('is atomic: a failure halfway leaves the old deck untouched', async () => {
      // "ghost" passes the catalog check but is missing from the cards table,
      // so the insert fails AFTER the old rows were deleted, inside the transaction.
      const ghost: Card = { kind: 'power', id: 'ghost', name: 'Ghost', power: 'fire' };
      const strict = await buildApp({ logger: false, catalog: { ...starterCatalog, ghost } });
      try {
        const login = await strict.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'alice', password: PASSWORD },
        });
        const call = as(strict, sessionCookie(login)!);
        const id = (await call('POST', '/api/decks', fireDeck)).json().deck.id;

        const res = await call('PUT', `/api/decks/${id}`, { name: 'Broken', cards: [{ cardId: 'ghost', count: 1 }] });
        expect(res.statusCode).toBe(500);

        const read = (await call('GET', `/api/decks/${id}`)).json().deck;
        expect(read.name).toBe('Fire');
        expect(read.cardCount).toBe(60);
        expect(read.valid).toBe(true);
      } finally {
        await strict.close();
      }
    });
  });

  describe('ownership: other people\'s decks look like they do not exist', () => {
    it('returns 404 (not 403) for read, update and delete', async () => {
      const id = (await alice('POST', '/api/decks', fireDeck)).json().deck.id;
      for (const res of [
        await bob('GET', `/api/decks/${id}`),
        await bob('PUT', `/api/decks/${id}`, { name: 'Stolen', cards: [] }),
        await bob('DELETE', `/api/decks/${id}`),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('DECK_NOT_FOUND');
      }
      // Still intact for the owner.
      expect((await alice('GET', `/api/decks/${id}`)).json().deck.name).toBe('Fire');
    });

    it('returns 404 for malformed ids', async () => {
      expect((await alice('GET', '/api/decks/not-a-uuid')).statusCode).toBe(404);
      expect((await alice('PUT', '/api/decks/not-a-uuid', fireDeck)).statusCode).toBe(404);
      expect((await alice('DELETE', '/api/decks/not-a-uuid')).statusCode).toBe(404);
    });
  });

  describe('delete', () => {
    it('removes the deck and its cards, then reports 404', async () => {
      const id = (await alice('POST', '/api/decks', fireDeck)).json().deck.id;
      expect((await alice('DELETE', `/api/decks/${id}`)).statusCode).toBe(204);
      expect((await alice('GET', `/api/decks/${id}`)).statusCode).toBe(404);
      expect((await alice('DELETE', `/api/decks/${id}`)).statusCode).toBe(404);
      const rows = await app.db.execute(sql`select count(*)::int as n from deck_cards`);
      expect((rows[0] as { n: number }).n).toBe(0);
    });
  });
});
