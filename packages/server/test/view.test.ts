import {
  createGame,
  simulateGame,
  starterCatalog,
  starterDecks,
  type CardInstance,
  type GameState,
  type PlayerIndex,
} from '@cardgame/engine';
import { describe, expect, it } from 'vitest';
import { viewFor } from '../src/game/view.js';

function fresh(seed = 42): GameState {
  const r = createGame(starterCatalog, starterDecks.fire!, starterDecks.water!, seed);
  if (!r.ok) throw new Error('createGame failed');
  return r.value.state;
}

const iids = (cards: CardInstance[]) => cards.map((c) => c.iid);

/** Card ids the given seat must never learn from its view. */
function secretsOf(state: GameState, seat: PlayerIndex): string[] {
  const opp: PlayerIndex = seat === 0 ? 1 : 0;
  const o = state.players[opp];
  const me = state.players[seat];
  return [...iids(o.hand), ...iids(o.deck), ...iids(o.prizes), ...iids(me.deck), ...iids(me.prizes)];
}

function leaks(state: GameState, seat: PlayerIndex): string[] {
  const json = JSON.stringify(viewFor(state, seat, null));
  return secretsOf(state, seat).filter((iid) => json.includes(`"${iid}"`));
}

describe('viewFor', () => {
  it('shows your own hand and only counts for deck and prizes', () => {
    const s = fresh();
    const v = viewFor(s, 0, null);
    expect(v.you.hand).toEqual(s.players[0].hand);
    expect(v.you.deckCount).toBe(s.players[0].deck.length);
    expect(v.you.prizeCount).toBe(6);
    expect(Object.keys(v.you)).not.toContain('deck');
    expect(Object.keys(v.you)).not.toContain('prizes');
  });

  it('shows the opponent only counts for hand, deck and prizes', () => {
    const s = fresh();
    const v = viewFor(s, 0, null);
    expect(v.opponent.handCount).toBe(s.players[1].hand.length);
    expect(v.opponent.deckCount).toBe(s.players[1].deck.length);
    expect(v.opponent.prizeCount).toBe(6);
    for (const key of ['hand', 'deck', 'prizes']) expect(Object.keys(v.opponent)).not.toContain(key);
  });

  it('never contains the random generator state or any seed', () => {
    const json = JSON.stringify(viewFor(fresh(), 1, null));
    expect(json.includes('rngState')).toBe(false);
    expect(json.includes('seed')).toBe(false);
  });

  it('is symmetric: each seat sees its own hand', () => {
    const s = fresh();
    expect(viewFor(s, 1, null).you.hand).toEqual(s.players[1].hand);
    expect(viewFor(s, 1, null).opponent.handCount).toBe(s.players[0].hand.length);
  });

  it('leaks no hidden card ids in a fresh game', () => {
    const s = fresh();
    expect(leaks(s, 0)).toEqual([]);
    expect(leaks(s, 1)).toEqual([]);
  });

  it('hides the opponent\'s starting creatures until both have placed, without revealing the bench size', () => {
    const s = fresh(7);
    const placedState = JSON.parse(JSON.stringify(s)) as GameState;
    // Pretend seat 1 placed an active creature and a bench creature already.
    const p1 = placedState.players[1];
    const basics = p1.hand.filter((c) => starterCatalog[c.cardId]!.kind === 'creature').slice(0, 2);
    const [first, second] = basics;
    if (!first) throw new Error('fixture: need a basic in hand');
    p1.hand = p1.hand.filter((c) => c !== first && c !== second && !basics.some((b) => b.iid === c.iid));
    const mk = (c: CardInstance) => ({ stack: [c], attached: [], damage: 0, status: null, poisoned: false, playedOnTurn: 0, evolvedOnTurn: 0 });
    p1.active = mk(first);
    p1.bench = second ? [mk(second)] : [];
    placedState.setup!.placed[1] = true;

    const before = viewFor(s, 0, null).opponent.handCount;
    const v = viewFor(placedState, 0, null);
    expect(v.opponent.active).toBeNull();
    expect(v.opponent.bench).toEqual([]);
    expect(v.opponent.handCount).toBe(before); // unchanged: placement is not revealed
    expect(v.setup!.opponent.placed).toBe(true);
    // Your own placed creatures are visible to you.
    expect(viewFor(placedState, 1, null).you.active).not.toBeNull();
  });

  it('carries the outcome and pending decisions', () => {
    const s = fresh();
    const v = viewFor(s, 0, { winner: 1, reason: 'forfeit' });
    expect(v.outcome).toEqual({ winner: 1, reason: 'forfeit' });
    expect(v.pendingDecisions).toEqual([]);
    expect(v.setup).not.toBeNull();
  });

  it('leaks nothing at any point of complete games (fuzz)', () => {
    let steps = 0;
    for (const seed of [3, 11, 29, 31]) {
      simulateGame(starterCatalog, starterDecks.fire!, starterDecks.leaf!, {
        seed,
        onStep: ({ after }) => {
          steps++;
          expect(leaks(after, 0)).toEqual([]);
          expect(leaks(after, 1)).toEqual([]);
        },
      });
    }
    expect(steps).toBeGreaterThan(40);
  });
});
