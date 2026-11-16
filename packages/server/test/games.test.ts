import { creatureCard, starterCatalog, type GameState } from '@cardgame/engine';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actorsFor } from '../src/game/room.js';
import { completeSetup, flush } from './game-helpers.js';
import { createTestApp, registerPlayer, resetDb, type Player } from './helpers.js';

describe('games over HTTP', () => {
  let app: FastifyInstance;
  let alice: Player;
  let bob: Player;
  let carol: Player;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    alice = await registerPlayer(app, 'alice');
    bob = await registerPlayer(app, 'bob');
    carol = await registerPlayer(app, 'carol');
  });

  const create = (p: Player) => p.call('POST', '/api/games', { deckId: p.deckId });
  const join = (p: Player, gameId: string) => p.call('POST', `/api/games/${gameId}/join`, { deckId: p.deckId });

  it('requires login', async () => {
    for (const [method, url] of [
      ['GET', '/api/games'],
      ['POST', '/api/games'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('creates a waiting game that shows up in the lobby', async () => {
    const res = await create(alice);
    expect(res.statusCode).toBe(201);
    const game = res.json().game;
    expect(game).toMatchObject({ status: 'waiting', seat: 0, players: [{ seat: 0, username: 'alice' }] });

    const lobby = (await bob.call('GET', '/api/games')).json();
    expect(lobby.current).toBeNull();
    expect(lobby.open).toHaveLength(1);
    expect(lobby.open[0]).toMatchObject({ id: game.id, creator: { username: 'alice' }, mine: false });
    expect((await alice.call('GET', '/api/games')).json().open[0].mine).toBe(true);
    expect((await alice.call('GET', '/api/games')).json().current.id).toBe(game.id);
  });

  it('rejects unfinished decks, other people\'s decks and bad ids', async () => {
    const draft = (await alice.call('POST', '/api/decks', { name: 'WIP', cards: [{ cardId: 'embercub', count: 2 }] })).json().deck;
    const invalid = await alice.call('POST', '/api/games', { deckId: draft.id });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('DECK_INVALID');
    expect(Array.isArray(invalid.json().error.details)).toBe(true);

    const stolen = await alice.call('POST', '/api/games', { deckId: bob.deckId });
    expect(stolen.statusCode).toBe(404);
    expect(stolen.json().error.code).toBe('DECK_NOT_FOUND');
    expect((await alice.call('POST', '/api/games', { deckId: 'nope' })).statusCode).toBe(400);
    expect((await alice.call('GET', '/api/games/not-a-uuid')).statusCode).toBe(404);
  });

  it('starts the game when someone joins', async () => {
    const g = (await create(alice)).json().game;
    const res = await join(bob, g.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().game).toMatchObject({ status: 'active', seat: 1 });
    expect(res.json().game.players.map((p: { username: string }) => p.username)).toEqual(['alice', 'bob']);
    expect((await carol.call('GET', '/api/games')).json().open).toHaveLength(0);
    expect(app.games.roomFor(alice.id)).toBeDefined();
    expect((await alice.call('GET', `/api/games/${g.id}`)).json().game.status).toBe('active');
    expect((await carol.call('GET', `/api/games/${g.id}`)).statusCode).toBe(404);
  });

  it('enforces one game per player', async () => {
    const mine = (await create(alice)).json().game;
    const again = await create(alice);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_IN_GAME');
    const bobsGame = (await create(bob)).json().game;
    expect((await join(alice, bobsGame.id)).json().error.code).toBe('ALREADY_IN_GAME');
    expect((await alice.call('DELETE', `/api/games/${mine.id}`)).statusCode).toBe(204);
    expect((await join(alice, bobsGame.id)).statusCode).toBe(200);
  });

  it('the database itself stops one player from creating two games at once', async () => {
    const [a, b] = await Promise.all([create(alice), create(alice)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const rows = await app.db.execute(sql`select count(*)::int as n from games`);
    expect((rows[0] as { n: number }).n).toBe(1); // the loser left nothing behind
  });

  it('two people joining the same game at once: exactly one gets in', async () => {
    const g = (await create(alice)).json().game;
    const [b, c] = await Promise.all([join(bob, g.id), join(carol, g.id)]);
    expect([b.statusCode, c.statusCode].sort()).toEqual([200, 409]);
    const loser = b.statusCode === 409 ? b : c;
    expect(loser.json().error.code).toBe('GAME_NOT_OPEN');
  });

  it('cannot join your own, a missing, a full or a cancelled game', async () => {
    const g = (await create(alice)).json().game;
    expect((await join(alice, g.id)).json().error.code).toBe('CANNOT_JOIN_OWN_GAME');
    expect((await join(bob, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    await join(bob, g.id);
    expect((await join(carol, g.id)).json().error.code).toBe('GAME_NOT_OPEN');

    const h = (await create(carol)).json().game;
    expect((await bob.call('DELETE', `/api/games/${h.id}`)).statusCode).toBe(404); // not the creator
    expect((await carol.call('DELETE', `/api/games/${h.id}`)).statusCode).toBe(204);
    expect((await join(alice, h.id)).json().error.code).toBe('GAME_NOT_OPEN');
  });

  describe('persistence', () => {
    it('saves every action and rebuilds the running game after a restart', async () => {
      const g = (await create(alice)).json().game;
      await join(bob, g.id);
      const room = app.games.roomFor(alice.id)!;
      await completeSetup(room);
      expect(room.seq).toBeGreaterThan(0);

      const logged = await app.db.execute(sql`select count(*)::int as n from game_actions`);
      expect((logged[0] as { n: number }).n).toBe(room.seq);

      const second = await createTestApp();
      try {
        expect(await second.games.recover()).toBe(1);
        const restored = second.games.roomFor(alice.id)!;
        expect(JSON.stringify(restored.state)).toBe(JSON.stringify(room.state));
        expect(restored.seq).toBe(room.seq);
      } finally {
        await second.close();
      }
    });

    it('stores the decks as they were at game start', async () => {
      const g = (await create(alice)).json().game;
      await join(bob, g.id);
      await alice.call('PUT', `/api/decks/${alice.deckId}`, { name: 'Changed', cards: [] });
      const rows = await app.db.execute(sql`select jsonb_array_length(deck)::int as n from game_players order by seat`);
      expect((rows[0] as { n: number }).n).toBeGreaterThan(1);
    });

    it('sudden death: finishes the game and starts a one-prize rematch for the same players', async () => {
      const g = (await create(alice)).json().game;
      await join(bob, g.id);
      const room = app.games.roomFor(alice.id)!;
      await completeSetup(room);

      const rigged = JSON.parse(JSON.stringify(room.state)) as GameState;
      for (const p of rigged.players) {
        p.bench = [];
        p.active!.poisoned = true;
        p.active!.damage = creatureCard(starterCatalog, p.active!).hp - 5;
      }
      room.state = rigged;
      const seat = actorsFor(room.state)[0]!;
      expect((await room.submit(room.userOf(seat), { type: 'END_TURN' })).ok).toBe(true);
      await flush();

      const games = await app.db.execute(
        sql`select status, end_reason, prize_count, rematch_of from games order by created_at`,
      );
      expect(games).toHaveLength(2);
      expect(games[0]).toMatchObject({ status: 'finished', end_reason: 'sudden_death_rematch' });
      expect(games[1]).toMatchObject({ status: 'active', prize_count: 1 });
      const inGame = await app.db.execute(sql`select count(*)::int as n from game_players where in_game`);
      expect((inGame[0] as { n: number }).n).toBe(2); // only the new game's players
      expect(app.games.roomFor(alice.id)!.id).not.toBe(room.id);
    });
  });
});
