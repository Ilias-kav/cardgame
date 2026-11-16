import { legalActions, starterCatalog } from '@cardgame/engine';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/game/protocol.js';
import { createTestApp, registerPlayer, resetDb, type Player } from './helpers.js';

interface TestSocket {
  ws: WebSocket;
  messages: ServerMessage[];
  send(message: unknown): void;
  waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate?: (m: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  close(): Promise<void>;
}

describe('WebSocket', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let alice: Player;
  let bob: Player;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address.replace('http', 'ws') + '/ws';
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    alice = await registerPlayer(app, 'alice');
    bob = await registerPlayer(app, 'bob');
  });
  afterEach(() => {
    for (const ws of sockets.splice(0)) ws.terminate();
  });

  /** Opens a connection and records what it receives. Rejects with the HTTP status if refused. */
  function open(sid: string | null, origin?: string): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (sid) headers.cookie = `sid=${sid}`;
      if (origin) headers.origin = origin;
      const ws = new WebSocket(baseUrl, { headers });
      sockets.push(ws);
      const messages: ServerMessage[] = [];
      ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
      ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.on('error', () => undefined);
      const socket: TestSocket = {
        ws,
        messages,
        send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
        waitFor: async (type, predicate) => {
          const deadline = Date.now() + 4000;
          for (;;) {
            const found = messages.find(
              (m): m is Extract<ServerMessage, { type: typeof type }> =>
                m.type === type && (!predicate || predicate(m as never)),
            );
            if (found) return found;
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
            await new Promise((r) => setTimeout(r, 10));
          }
        },
        close: () =>
          new Promise((r) => {
            ws.once('close', () => r());
            ws.close();
          }),
      };
      ws.on('open', () => resolve(socket));
    });
  }

  const startGame = async () => {
    const g = (await alice.call('POST', '/api/games', { deckId: alice.deckId })).json().game;
    await bob.call('POST', `/api/games/${g.id}/join`, { deckId: bob.deckId });
    return g.id as string;
  };

  it('refuses connections without a valid session (401) or from a foreign origin (403)', async () => {
    await expect(open(null)).rejects.toThrow('HTTP 401');
    await expect(open('not-a-session')).rejects.toThrow('HTTP 401');
    await expect(open(alice.sid, 'https://evil.example')).rejects.toThrow('HTTP 403');
    const ok = await open(alice.sid, 'http://localhost:5173');
    expect((await ok.waitFor('hello')).user.username).toBe('alice');
  });

  it('greets with hello and answers ping', async () => {
    const a = await open(alice.sid);
    expect(await a.waitFor('hello')).toMatchObject({ user: { username: 'alice' }, game: null });
    a.send({ type: 'ping' });
    await a.waitFor('pong');
  });

  it('plays: both players are told the game started, and moves reach both with hidden info removed', async () => {
    const a = await open(alice.sid);
    const b = await open(bob.sid);
    await a.waitFor('hello');
    await b.waitFor('hello');
    const gameId = await startGame();

    expect(await a.waitFor('game.started')).toMatchObject({ gameId, seat: 0, opponent: 'bob' });
    expect(await b.waitFor('game.started')).toMatchObject({ gameId, seat: 1, opponent: 'alice' });
    await a.waitFor('game.update', (m) => m.seq === 0);

    const room = app.games.roomFor(alice.id)!;
    const move = legalActions(starterCatalog, room.state, 0)[0]!;
    a.send({ type: 'game.action', action: move, requestId: 'r1' });
    expect(await a.waitFor('ack')).toEqual({ type: 'ack', requestId: 'r1' });

    const forBob = await b.waitFor('game.update', (m) => m.seq === 1);
    expect(forBob.view.seat).toBe(1);
    expect(forBob.view.opponent.active).toBeNull(); // placements stay secret during setup
    const json = JSON.stringify(forBob);
    expect(json.includes('rngState')).toBe(false);
    for (const card of room.state.players[0].hand) expect(json.includes(`"${card.iid}"`)).toBe(false);
  });

  it('answers a rejected move with an error that names the request', async () => {
    const a = await open(alice.sid);
    const b = await open(bob.sid);
    await a.waitFor('hello');
    await b.waitFor('hello');
    await startGame();
    await b.waitFor('game.started');
    b.send({ type: 'game.action', action: { type: 'END_TURN' }, requestId: 'oops' });
    expect(await b.waitFor('error')).toMatchObject({ code: 'WRONG_PHASE', requestId: 'oops' });
  });

  it('answers garbage with BAD_MESSAGE and keeps the connection open', async () => {
    const a = await open(alice.sid);
    await a.waitFor('hello');
    a.send('this is not json');
    a.send({ type: 'game.hack' });
    a.send({ type: 'game.action', action: { type: 'ATTACK', attackIndex: -5 } });
    await new Promise((r) => setTimeout(r, 100));
    expect(a.messages.filter((m) => m.type === 'error' && m.code === 'BAD_MESSAGE')).toHaveLength(3);
    a.send({ type: 'ping' });
    await a.waitFor('pong');
  });

  it('says NO_ACTIVE_GAME when you act without a game', async () => {
    const a = await open(alice.sid);
    await a.waitFor('hello');
    a.send({ type: 'game.sync' });
    expect(await a.waitFor('error')).toMatchObject({ code: 'NO_ACTIVE_GAME' });
  });

  it('cuts off clients that send far too many messages', async () => {
    const a = await open(alice.sid);
    await a.waitFor('hello');
    for (let i = 0; i < 200; i++) a.ws.send(JSON.stringify({ type: 'ping' }));
    await a.waitFor('error', (m) => m.code === 'RATE_LIMITED');
    await new Promise<void>((resolve) => (a.ws.readyState === WebSocket.CLOSED ? resolve() : a.ws.once('close', () => resolve())));
  });

  it('reconnecting delivers the hello and the current game state', async () => {
    const a1 = await open(alice.sid);
    await a1.waitFor('hello');
    const gameId = await startGame();
    await a1.waitFor('game.started');
    await a1.close();

    const a2 = await open(alice.sid);
    expect(await a2.waitFor('hello')).toMatchObject({ game: { id: gameId, status: 'active' } });
    const state = await a2.waitFor('game.state');
    expect(state).toMatchObject({ gameId, view: { seat: 0 } });
  });

  it('forfeiting ends the game for both players', async () => {
    const a = await open(alice.sid);
    const b = await open(bob.sid);
    await a.waitFor('hello');
    await b.waitFor('hello');
    await startGame();
    await b.waitFor('game.started');
    b.send({ type: 'game.forfeit' });
    expect((await a.waitFor('game.over')).outcome).toEqual({ winner: 0, reason: 'forfeit' });
    expect((await b.waitFor('game.over')).outcome).toEqual({ winner: 0, reason: 'forfeit' });
    expect((await alice.call('GET', '/api/games')).json().current).toBeNull();
  });
});
