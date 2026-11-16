import { describe, expect, it } from 'vitest';
import {
  alice,
  bob,
  carol,
  connectClient,
  errorOf,
  makeHarness,
} from './game-helpers.js';

describe('lobby: creating, listing, cancelling', () => {
  it('creates a waiting game and lists it for others', async () => {
    const h = makeHarness();
    const game = await h.manager.createGame(alice, 'fire');
    expect(game).toMatchObject({ status: 'waiting', seat: 0 });
    expect(game.players).toEqual([{ seat: 0, username: 'alice' }]);

    const open = await h.manager.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: game.id, creatorUsername: 'alice' });
    expect((await h.manager.current(alice))?.id).toBe(game.id);
    expect(await h.manager.current(bob)).toBeNull();
  });

  it('only accepts valid decks that belong to you', async () => {
    const h = makeHarness();
    const draft = await errorOf(h.manager.createGame(alice, 'draft'));
    expect(draft).toMatchObject({ statusCode: 400, code: 'DECK_INVALID' });
    expect(Array.isArray(draft!.details)).toBe(true);

    expect(await errorOf(h.manager.createGame(alice, 'nope'))).toMatchObject({ statusCode: 404, code: 'DECK_NOT_FOUND' });
    h.decks.add(bob.id, 'secret', [{ cardId: 'embercub', count: 1 }]);
    expect(await errorOf(h.manager.createGame(alice, 'secret'))).toMatchObject({ code: 'DECK_NOT_FOUND' });
  });

  it('a player can only be in one game at a time', async () => {
    const h = makeHarness();
    const mine = await h.manager.createGame(alice, 'fire');
    expect(await errorOf(h.manager.createGame(alice, 'fire'))).toMatchObject({ statusCode: 409, code: 'ALREADY_IN_GAME' });

    const bobs = await h.manager.createGame(bob, 'water');
    // alice is in a waiting game, so she cannot join bob's
    expect(await errorOf(h.manager.joinGame(alice, bobs.id, 'fire'))).toMatchObject({ code: 'ALREADY_IN_GAME' });
    // ...until she cancels hers
    await h.manager.cancelGame(alice, mine.id);
    expect((await h.manager.joinGame(alice, bobs.id, 'fire')).status).toBe('active');
  });

  it('cannot join your own game, a missing game, or a game that is full or cancelled', async () => {
    const h = makeHarness();
    const g = await h.manager.createGame(alice, 'fire');
    expect(await errorOf(h.manager.joinGame(alice, g.id, 'water'))).toMatchObject({ code: 'CANNOT_JOIN_OWN_GAME' });
    expect(await errorOf(h.manager.joinGame(bob, 'missing', 'water'))).toMatchObject({ statusCode: 404, code: 'GAME_NOT_FOUND' });

    await h.manager.joinGame(bob, g.id, 'water');
    expect(await errorOf(h.manager.joinGame(carol, g.id, 'water'))).toMatchObject({ statusCode: 409, code: 'GAME_NOT_OPEN' });

    const other = await h.manager.createGame(carol, 'fire');
    await h.manager.cancelGame(carol, other.id);
    expect(await errorOf(h.manager.joinGame(carol, other.id, 'fire'))).toMatchObject({ code: 'GAME_NOT_OPEN' });
  });

  it('only the creator can cancel, only while waiting, and then they are free again', async () => {
    const h = makeHarness();
    const g = await h.manager.createGame(alice, 'fire');
    expect(await errorOf(h.manager.cancelGame(bob, g.id))).toMatchObject({ statusCode: 404 });
    await h.manager.cancelGame(alice, g.id);
    expect(await h.manager.listOpen()).toHaveLength(0);
    expect(await h.manager.current(alice)).toBeNull();
    expect((await h.manager.createGame(alice, 'fire')).status).toBe('waiting');
  });

  it('getGame is visible to participants only', async () => {
    const h = makeHarness();
    const g = await h.manager.createGame(alice, 'fire');
    expect((await h.manager.getGame(alice, g.id)).id).toBe(g.id);
    expect(await errorOf(h.manager.getGame(bob, g.id))).toMatchObject({ statusCode: 404 });
  });

  it('cancels waiting games nobody joined in time and tells the creator', async () => {
    const h = makeHarness();
    const client = await connectClient(h.manager, alice);
    const g = await h.manager.createGame(alice, 'fire');
    h.store.backdate(g.id, new Date(h.clock.now() - 31 * 60_000));
    expect(await h.manager.sweepWaiting()).toBe(1);
    expect(client.last('game.cancelled')).toEqual({ type: 'game.cancelled', gameId: g.id, reason: 'expired' });
    expect(await h.manager.listOpen()).toHaveLength(0);
    expect((await h.manager.createGame(alice, 'fire')).status).toBe('waiting');
  });

  it('keeps fresh waiting games when sweeping', async () => {
    const h = makeHarness();
    await h.manager.createGame(alice, 'fire');
    expect(await h.manager.sweepWaiting()).toBe(0);
    expect(await h.manager.listOpen()).toHaveLength(1);
  });
});

describe('connections', () => {
  it('greets with the user and their current game, or null', async () => {
    const h = makeHarness();
    const none = await connectClient(h.manager, alice);
    expect(none.messages[0]).toEqual({ type: 'hello', user: { id: alice.id, username: 'alice' }, game: null });

    const g = await h.manager.createGame(bob, 'fire');
    const waiting = await connectClient(h.manager, bob);
    expect(waiting.messages[0]).toMatchObject({ type: 'hello', game: { id: g.id, status: 'waiting' } });
  });

  it('answers ping and rejects game messages when not in a game', async () => {
    const h = makeHarness();
    const c = await connectClient(h.manager, alice);
    await h.manager.handleMessage(alice, c.send, { type: 'ping' });
    expect(c.last('pong')).toEqual({ type: 'pong' });
    await h.manager.handleMessage(alice, c.send, { type: 'game.action', action: { type: 'END_TURN' }, requestId: 'r9' });
    expect(c.last('error')).toMatchObject({ code: 'NO_ACTIVE_GAME', requestId: 'r9' });
    await h.manager.handleMessage(alice, c.send, { type: 'game.sync' });
    expect(c.last('error')).toMatchObject({ code: 'NO_ACTIVE_GAME' });
  });
});
