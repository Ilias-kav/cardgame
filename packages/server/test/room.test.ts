import { creatureCard, legalActions, starterCatalog, type GameState } from '@cardgame/engine';
import { describe, expect, it } from 'vitest';
import { replayGame } from '../src/game/replay.js';
import { actorsFor } from '../src/game/room.js';
import {
  alice,
  bob,
  completeSetup,
  connectClient,
  flush,
  makeHarness,
  playToEnd,
  setupSeat,
  startGame,
} from './game-helpers.js';

describe('starting a game', () => {
  it('tells both players, with the opening events and their own view', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);

    expect(a.last('game.started')).toMatchObject({ seat: 0, opponent: 'bob', rematchOf: null });
    expect(b.last('game.started')).toMatchObject({ seat: 1, opponent: 'alice' });

    const first = a.last('game.update')!;
    expect(first.seq).toBe(0);
    expect(first.events.some((e) => e.type === 'COIN_FLIP')).toBe(true);
    expect(first.view.seat).toBe(0);
    expect(b.last('game.update')!.view.seat).toBe(1);
    expect(first.view.you.hand).toEqual(room.state.players[0].hand);
    expect(room.deadline).toBe(h.clock.now() + 120_000);
  });

  it('players without a socket still get a game, and can connect later to receive the state', async () => {
    const h = makeHarness();
    const room = await startGame(h);
    expect(room.outcome).toBeNull();
    const late = await connectClient(h.manager, alice);
    expect(late.last('game.state')).toMatchObject({ gameId: room.id, seq: 0, view: { seat: 0 } });
  });
});

describe('actions', () => {
  it('accepts legal actions, saves them and updates both players', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);

    expect(room.state.phase).toBe('playing');
    expect(room.seq).toBe(h.store.actionsOf(room.id).length);
    expect(a.last('game.update')!.seq).toBe(room.seq);
    expect(b.last('game.update')!.seq).toBe(room.seq);
    expect(h.store.actionsOf(room.id).map((x) => x.seq)).toEqual(Array.from({ length: room.seq }, (_, i) => i + 1));
  });

  it('answers a rejected action with an error and changes nothing', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);
    const waiting = actorsFor(room.state)[0]!;
    const wrong = waiting === 0 ? bob : alice;
    const wrongClient = waiting === 0 ? b : a;
    const before = JSON.stringify(room.state);
    const seqBefore = room.seq;
    const updatesBefore = a.ofType('game.update').length;

    await h.manager.handleMessage(wrong, wrongClient.send, {
      type: 'game.action',
      action: { type: 'END_TURN' },
      requestId: 'r1',
    });
    expect(wrongClient.last('error')).toMatchObject({ code: 'NOT_YOUR_TURN', requestId: 'r1' });
    expect(JSON.stringify(room.state)).toBe(before);
    expect(room.seq).toBe(seqBefore);
    expect(h.store.actionsOf(room.id)).toHaveLength(seqBefore);
    expect(a.ofType('game.update')).toHaveLength(updatesBefore);
  });

  it('acknowledges accepted actions to the sender', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const room = await startGame(h);
    const first = legalActions(starterCatalog, room.state, 0)[0]!;
    await h.manager.handleMessage(alice, a.send, { type: 'game.action', action: first as never, requestId: 'req-7' });
    expect(a.last('ack')).toEqual({ type: 'ack', requestId: 'req-7' });
  });

  it('processes simultaneous requests one at a time', async () => {
    const h = makeHarness();
    const room = await startGame(h);
    await completeSetup(room);
    const seat = actorsFor(room.state)[0]!;
    const user = room.userOf(seat);
    const [r1, r2] = await Promise.all([
      room.submit(user, { type: 'END_TURN' }),
      room.submit(user, { type: 'END_TURN' }),
    ]);
    // The first ends the turn; the second then arrives when it is no longer their turn.
    expect([r1.ok, r2.ok]).toEqual([true, false]);
    if (!r2.ok) expect(r2.error.code).toBe('NOT_YOUR_TURN');
  });

  it('does not apply a move that could not be saved, and accepts a retry', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const room = await startGame(h);
    const first = legalActions(starterCatalog, room.state, 0)[0]!;
    h.store.failNextAppend = true;
    const updates = a.ofType('game.update').length;
    const failed = await room.submit(alice.id, first);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('PERSISTENCE_FAILED');
    expect(room.seq).toBe(0);
    expect(room.state.phase).toBe('setup');
    expect(a.ofType('game.update')).toHaveLength(updates);
    expect((await room.submit(alice.id, first)).ok).toBe(true);
    expect(room.seq).toBe(1);
  });

  it('refuses actions from people who are not in the game', async () => {
    const h = makeHarness();
    const room = await startGame(h);
    const r = await room.submit('u-carol', { type: 'END_TURN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_A_PLAYER');
  });
});

describe('a complete game', () => {
  it('plays to the end; the log replays to exactly the same state', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);
    await playToEnd(room, 21);

    expect(room.outcome).not.toBeNull();
    expect(room.state.phase).toBe('finished');
    expect(h.store.statusOf(room.id)).toBe('finished');
    expect(h.store.outcomeOf(room.id)).toEqual(room.outcome);

    const over = a.last('game.over')!;
    expect(over.outcome).toEqual(room.outcome);
    expect(b.last('game.over')!.outcome).toEqual(room.outcome);
    expect(a.messages.at(-1)!.type).toBe('game.over');

    const record = (await h.store.getGame(room.id))!;
    const replayed = replayGame(starterCatalog, record, h.store.actionsOf(room.id));
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(room.state));
    expect(replayed.seq).toBe(room.seq);

    // Both players are free again.
    expect(h.manager.roomFor(alice.id)).toBeUndefined();
    expect(await h.manager.current(alice)).toBeNull();
    expect((await h.manager.createGame(alice, 'fire')).status).toBe('waiting');
  });

  it('keeps hidden information out of everything sent over the wire', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const room = await startGame(h);
    await completeSetup(room);
    await playToEnd(room, 3, 25);
    const hidden = [...room.state.players[1].hand, ...room.state.players[1].deck, ...room.state.players[1].prizes]
      .map((c) => c.iid);
    const everything = JSON.stringify(a.messages);
    // Nothing alice ever received names a card that is (still) hidden from her.
    for (const iid of hidden) expect(everything.includes(`"${iid}"`)).toBe(false);
    expect(everything.includes('rngState')).toBe(false);
  });
});

describe('recovery after a restart', () => {
  it('rebuilds a running game from the database and lets it continue', async () => {
    const h = makeHarness();
    const room = await startGame(h);
    await completeSetup(room);
    await playToEnd(room, 5, 12); // a few moves into the game
    expect(room.outcome).toBeNull();
    const snapshot = JSON.stringify(room.state);
    const seq = room.seq;

    const second = h.restart();
    expect(await second.recover()).toBe(1);
    const restored = second.roomFor(alice.id)!;
    expect(JSON.stringify(restored.state)).toBe(snapshot);
    expect(restored.seq).toBe(seq);
    expect(second.roomFor(bob.id)).toBe(restored);

    await playToEnd(restored, 9, 3); // the restored game keeps working
    expect(restored.seq).toBe(seq + 3);
    expect(h.store.actionsOf(restored.id)).toHaveLength(seq + 3);

    // A reconnecting player gets the full state.
    const c = await connectClient(second, alice);
    expect(c.last('game.state')).toMatchObject({ gameId: restored.id, view: { seat: 0 } });
  });

  it('finishes a recovered game that had already reached its end', async () => {
    const h = makeHarness();
    const room = await startGame(h);
    await completeSetup(room);
    await playToEnd(room, 21);
    const record = (await h.store.getGame(room.id))!;
    expect(record.status).toBe('finished'); // nothing to recover
    const second = h.restart();
    expect(await second.recover()).toBe(0);
  });

  it('marks a game abandoned if its log cannot be replayed', async () => {
    const h = makeHarness();
    const room = await startGame(h);
    await h.store.appendAction(room.id, 1, 0, { type: 'END_TURN' }); // illegal during setup
    const second = h.restart();
    expect(await second.recover()).toBe(0);
    expect(h.store.outcomeOf(room.id)).toEqual({ winner: null, reason: 'abandoned' });
    expect(h.logs.some((l) => l.includes('Could not recover'))).toBe(true);
  });
});

describe('timers', () => {
  it('a player who does not act in time loses', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);
    const slacker = actorsFor(room.state)[0]!;

    await h.clock.advance(119_000);
    expect(room.outcome).toBeNull();
    await h.clock.advance(2_000);
    expect(room.outcome).toEqual({ winner: slacker === 0 ? 1 : 0, reason: 'timeout' });
    expect(a.last('game.over')!.outcome.reason).toBe('timeout');
    expect(b.last('game.over')!.outcome.reason).toBe('timeout');
    expect(h.store.statusOf(room.id)).toBe('finished');
  });

  it('the turn timer restarts for the next player but not after every action', async () => {
    const h = makeHarness();
    await connectClient(h.manager, alice);
    await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);
    const first = room.deadline!;
    expect(first).toBe(h.clock.now() + 120_000);

    await h.clock.advance(50_000);
    const seat = actorsFor(room.state)[0]!;
    // A move that does not end the turn leaves the deadline alone.
    const small = legalActions(starterCatalog, room.state, seat).find((x) => x.type === 'ATTACH_POWER' || x.type === 'PLAY_BASIC');
    if (small) {
      await room.submit(room.userOf(seat), small);
      expect(room.deadline).toBe(first);
    }
    await room.submit(room.userOf(seat), { type: 'END_TURN' });
    expect(room.deadline).toBe(h.clock.now() + 120_000);
  });

  it('during setup: if nobody places the game is abandoned', async () => {
    const h = makeHarness();
    await connectClient(h.manager, alice);
    await connectClient(h.manager, bob);
    const room = await startGame(h);
    await h.clock.advance(121_000);
    expect(room.outcome).toEqual({ winner: null, reason: 'abandoned' });
    expect(h.store.statusOf(room.id)).toBe('finished');
  });

  it('during setup: someone who never places loses to the one who did', async () => {
    const h = makeHarness();
    await connectClient(h.manager, alice);
    await connectClient(h.manager, bob);
    const room = await startGame(h);
    await setupSeat(room, 0);
    await h.clock.advance(121_000);
    expect(room.outcome).toEqual({ winner: 0, reason: 'timeout' });
  });

  it('forfeiting ends the game at once', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);
    await h.manager.handleMessage(bob, b.send, { type: 'game.forfeit' });
    expect(room.outcome).toEqual({ winner: 0, reason: 'forfeit' });
    expect(a.last('game.over')!.outcome.winner).toBe(0);
    expect(h.clock.pending()).toBe(0); // no timers left behind
  });
});

describe('disconnects', () => {
  it('forfeits after the grace period', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);

    b.disconnect();
    await h.clock.advance(59_000);
    expect(room.outcome).toBeNull();
    await h.clock.advance(2_000);
    expect(room.outcome).toEqual({ winner: 0, reason: 'disconnect' });
    expect(a.last('game.over')!.outcome.reason).toBe('disconnect');
  });

  it('coming back in time cancels the forfeit and delivers the current state', async () => {
    const h = makeHarness();
    await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);

    b.disconnect();
    await h.clock.advance(30_000);
    const b2 = await connectClient(h.manager, bob);
    expect(b2.last('game.state')).toMatchObject({ gameId: room.id, seq: room.seq, view: { seat: 1 } });
    await h.clock.advance(40_000); // total 70s since the disconnect, but no forfeit
    expect(room.outcome).toBeNull();
  });

  it('a second open connection keeps the player present', async () => {
    const h = makeHarness();
    await connectClient(h.manager, alice);
    const b1 = await connectClient(h.manager, bob);
    await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);
    b1.disconnect();
    await h.clock.advance(70_000);
    expect(room.outcome).toBeNull();
  });

  it('if both players are gone the game is abandoned, with no winner', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    const b = await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);
    a.disconnect();
    b.disconnect();
    await h.clock.advance(61_000);
    expect(room.outcome).toEqual({ winner: null, reason: 'abandoned' });
  });

  it('a player who never connects at all is dealt with the same way', async () => {
    const h = makeHarness();
    await connectClient(h.manager, alice); // bob never opens a socket
    const room = await startGame(h);
    await h.clock.advance(61_000);
    expect(room.outcome).toEqual({ winner: 0, reason: 'disconnect' });
  });
});

describe('sudden death', () => {
  it('starts a new one-prize game for the same players when both take the last prize', async () => {
    const h = makeHarness();
    const a = await connectClient(h.manager, alice);
    await connectClient(h.manager, bob);
    const room = await startGame(h);
    await completeSetup(room);

    // Rig the board: both active creatures are poisoned and about to die, no benches.
    const rigged = JSON.parse(JSON.stringify(room.state)) as GameState;
    for (const p of rigged.players) {
      p.bench = [];
      const c = p.active!;
      c.poisoned = true;
      c.damage = creatureCard(starterCatalog, c).hp - 5;
    }
    room.state = rigged;

    const seat = actorsFor(room.state)[0]!;
    expect((await room.submit(room.userOf(seat), { type: 'END_TURN' })).ok).toBe(true);
    await flush();

    expect(room.outcome).toEqual({ winner: null, reason: 'sudden_death_rematch' });
    const over = a.last('game.over')!;
    expect(over.rematchGameId).not.toBeNull();

    const rematch = h.manager.roomFor(alice.id)!;
    expect(rematch.id).toBe(over.rematchGameId);
    expect(rematch.id).not.toBe(room.id);
    expect(h.manager.roomFor(bob.id)).toBe(rematch);
    expect(rematch.state.prizeCount).toBe(1);
    expect(rematch.state.players[0].prizes).toHaveLength(1);
    expect(a.last('game.started')).toMatchObject({ rematchOf: room.id });
    // the old game's messages come first
    const types = a.messages.map((m) => m.type);
    expect(types.lastIndexOf('game.over')).toBeLessThan(types.lastIndexOf('game.started'));
    expect(h.store.statusOf(room.id)).toBe('finished');
    expect(h.store.statusOf(rematch.id)).toBe('active');
  });
});
