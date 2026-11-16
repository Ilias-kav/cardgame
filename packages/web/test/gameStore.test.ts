import type { GameEvent } from '@cardgame/engine';
import type { PlayerView, ServerMessage } from '@cardgame/protocol';
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState, type GameClientState } from '../src/game/gameStore.js';

const view = (seat: 0 | 1 = 0, outcome: PlayerView['outcome'] = null) => ({ seat, outcome }) as unknown as PlayerView;
const ev = (turn: number): GameEvent => ({ type: 'TURN_STARTED', player: 0, turn });

const run = (messages: ServerMessage[], from: GameClientState = initialGameState) =>
  messages.reduce((s, message) => gameReducer(s, { type: 'message', message }), from);

const started: ServerMessage = { type: 'game.started', gameId: 'g1', seat: 0, opponent: 'bob', rematchOf: null };
const update = (seq: number, events: GameEvent[] = []): ServerMessage => ({
  type: 'game.update',
  gameId: 'g1',
  seq,
  events,
  deadline: 5000 + seq,
  view: view(),
});

describe('gameReducer', () => {
  it('starts from nothing', () => {
    expect(initialGameState).toMatchObject({ gameId: null, view: null, seq: -1, over: null, log: [] });
  });

  it('tracks connection status', () => {
    expect(gameReducer(initialGameState, { type: 'status', status: 'open' }).connection).toBe('open');
  });

  it('game.started sets up a fresh game and counts the start', () => {
    const s = run([started]);
    expect(s).toMatchObject({ gameId: 'g1', seat: 0, opponent: 'bob', view: null, seq: -1, startedCount: 1 });
    expect(s.helloGame).toEqual({ id: 'g1', status: 'active' });
  });

  it('applies updates in order, keeping the newest view, deadline and a log', () => {
    const s = run([started, update(0, [ev(1)]), update(1, [ev(2), ev(3)])]);
    expect(s.seq).toBe(1);
    expect(s.deadline).toBe(5001);
    expect(s.log.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(s.log.map((l) => (l.event as { turn: number }).turn)).toEqual([1, 2, 3]);
    expect(s.needsSync).toBe(false);
  });

  it('ignores duplicate or old updates', () => {
    const once = run([started, update(0, [ev(1)]), update(1, [ev(2)])]);
    const again = run([update(1, [ev(2)]), update(0, [ev(1)])], once);
    expect(again).toBe(once);
  });

  it('asks for a snapshot when an update was missed', () => {
    const s = run([started, update(0), update(3)]);
    expect(s.needsSync).toBe(true);
    expect(s.seq).toBe(3);
  });

  it('game.state replaces everything from a snapshot and clears the sync request', () => {
    const gap = run([started, update(0), update(3)]);
    const s = run([{ type: 'game.state', gameId: 'g1', seq: 7, deadline: 99, view: view(1) }], gap);
    expect(s).toMatchObject({ seq: 7, deadline: 99, seat: 1, needsSync: false });
    expect(s.opponent).toBe('bob'); // same game: what we knew stays
  });

  it('a snapshot of a different game starts with a clean slate', () => {
    const old = run([started, update(0, [ev(1)])]);
    const s = run([{ type: 'game.state', gameId: 'g2', seq: 4, deadline: null, view: view() }], old);
    expect(s.gameId).toBe('g2');
    expect(s.log).toEqual([]);
    expect(s.opponent).toBeNull();
  });

  it('ignores updates for a game that is not the current one', () => {
    const s = run([started, update(0)]);
    const other = run([{ ...update(1), gameId: 'old' } as ServerMessage], s);
    expect(other).toBe(s);
  });

  it('game.over records the outcome and stops the clock', () => {
    const s = run([started, update(0), { type: 'game.over', gameId: 'g1', outcome: { winner: 1, reason: 'timeout' }, rematchGameId: null }]);
    expect(s.over).toEqual({ outcome: { winner: 1, reason: 'timeout' }, rematchGameId: null });
    expect(s.deadline).toBeNull();
  });

  it('a rematch (game.started) clears the old result', () => {
    const over = run([started, update(0), { type: 'game.over', gameId: 'g1', outcome: { winner: null, reason: 'sudden_death_rematch' }, rematchGameId: 'g2' }]);
    const s = run([{ type: 'game.started', gameId: 'g2', seat: 0, opponent: 'bob', rematchOf: 'g1' }], over);
    expect(s.over).toBeNull();
    expect(s.gameId).toBe('g2');
    expect(s.startedCount).toBe(2);
    expect(s.log).toEqual([]);
  });

  it('hello without a game, after a running game, means it ended while we were away', () => {
    const s = run([started, update(0), { type: 'hello', user: { id: 'u', username: 'alice' }, game: null }]);
    expect(s.over).toEqual({ outcome: null, rematchGameId: null });
    const fresh = run([{ type: 'hello', user: { id: 'u', username: 'alice' }, game: null }]);
    expect(fresh.over).toBeNull();
    const resumed = run([{ type: 'hello', user: { id: 'u', username: 'alice' }, game: { id: 'g1', status: 'active' } }], run([started, update(0)]));
    expect(resumed.over).toBeNull();
  });

  it('surfaces errors and cancellations as notices with fresh ids', () => {
    const a = run([{ type: 'error', code: 'NOT_YOUR_TURN', message: 'It is not your turn' }]);
    expect(a.notice).toMatchObject({ text: 'It is not your turn', tone: 'error' });
    const b = run([{ type: 'error', code: 'NOT_YOUR_TURN', message: 'It is not your turn' }], a);
    expect(b.notice!.id).not.toBe(a.notice!.id);
    expect(gameReducer(b, { type: 'clearNotice' }).notice).toBeNull();
    const c = run([{ type: 'game.cancelled', gameId: 'x', reason: 'expired' }]);
    expect(c.notice?.tone).toBe('info');
  });

  it('keeps the log bounded', () => {
    let s = run([started]);
    for (let i = 0; i < 400; i++) s = run([update(i, [ev(i)])], s);
    expect(s.log.length).toBeLessThanOrEqual(300);
    expect(s.log[s.log.length - 1]!.id).toBe(400);
  });

  it('reset forgets the game but keeps the start counter (so navigation does not re-trigger)', () => {
    const s = run([started]);
    const r = gameReducer(s, { type: 'reset' });
    expect(r.gameId).toBeNull();
    expect(r.startedCount).toBe(1);
  });

  it('reset keeps the connection status (the socket is still open after leaving a game)', () => {
    const open = gameReducer(run([started]), { type: 'status', status: 'open' });
    expect(gameReducer(open, { type: 'reset' }).connection).toBe('open');
  });
});
