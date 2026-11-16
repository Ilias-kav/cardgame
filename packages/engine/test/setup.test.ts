import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getCard,
  isBasicCreature,
  type DeckEntry,
  type GameState,
  type PlayerIndex,
  type Transition,
} from '../src/index.js';
import { catalog, oneBasicDeck, starterDeck } from './fixtures.js';

function newGame(seed: number, a: DeckEntry[] = starterDeck, b: DeckEntry[] = starterDeck) {
  const res = createGame(catalog, a, b, seed);
  if (!res.ok) throw new Error(JSON.stringify(res.error));
  return (res as { ok: true; value: Transition }).value;
}

function totalCards(state: GameState, p: PlayerIndex): number {
  const pl = state.players[p];
  const inPlay = [pl.active, ...pl.bench].flatMap((c) => (c ? [...c.stack, ...c.attached] : []));
  return pl.deck.length + pl.hand.length + pl.prizes.length + pl.discard.length + inPlay.length;
}

function basicsInHand(state: GameState, p: PlayerIndex) {
  return state.players[p].hand.filter((c) => isBasicCreature(getCard(catalog, c.cardId)));
}

/** Runs the whole setup: extra draws, then place first basic as active, rest on bench. */
function completeSetup(start: GameState): GameState {
  let state = start;
  for (const p of [0, 1] as const) {
    const avail = state.setup!.extraDrawAvailable[p];
    if (avail > 0) {
      const r = applyAction(catalog, state, p, { type: 'SETUP_DRAW_EXTRA', count: avail });
      if (!r.ok) throw new Error(r.error.message);
      state = r.value.state;
    }
    const [first, ...rest] = basicsInHand(state, p);
    const r = applyAction(catalog, state, p, {
      type: 'SETUP_PLACE',
      active: first!.iid,
      bench: rest.slice(0, 5).map((c) => c.iid),
    });
    if (!r.ok) throw new Error(r.error.message);
    state = r.value.state;
  }
  return state;
}

describe('createGame', () => {
  it('deals 7 cards and 6 prizes from a 60-card deck, with a basic in hand', () => {
    const { state } = newGame(1);
    for (const p of [0, 1] as const) {
      const pl = state.players[p];
      expect(pl.hand).toHaveLength(7);
      expect(pl.prizes).toHaveLength(6);
      expect(pl.deck).toHaveLength(47);
      expect(basicsInHand(state, p).length).toBeGreaterThan(0);
    }
    expect(state.phase).toBe('setup');
  });

  it('is deterministic for the same seed', () => {
    expect(newGame(77)).toEqual(newGame(77));
  });

  it('records the coin flip and picks the first player from it', () => {
    const { state, events } = newGame(3);
    const flip = events.find((e) => e.type === 'COIN_FLIP');
    expect(flip).toBeTruthy();
    if (flip?.type === 'COIN_FLIP' && flip.purpose === 'first_player') {
      expect(flip.winner).toBe(state.firstPlayer);
      expect(flip.winner).toBe(flip.heads ? 0 : 1);
    }
  });

  it('both first players occur across seeds', () => {
    const firsts = new Set(Array.from({ length: 40 }, (_, i) => newGame(i).state.firstPlayer));
    expect(firsts.size).toBe(2);
  });

  it('supports a custom prize count (sudden death)', () => {
    const res = createGame(catalog, starterDeck, starterDeck, 5, { prizeCount: 1 });
    expect(res.ok).toBe(true);
    const { state } = (res as { ok: true; value: Transition }).value;
    expect(state.players[0].prizes).toHaveLength(1);
    expect(state.players[0].deck).toHaveLength(52);
  });

  it('rejects an invalid deck', () => {
    const res = createGame(catalog, starterDeck.slice(0, 2), starterDeck, 1);
    expect(res.ok).toBe(false);
  });

  it('keeps invariants under many mulligans (deck with a single basic)', () => {
    let sawMulligan = false;
    let sawExtra = false;
    for (let seed = 1; seed <= 200; seed++) {
      const { state, events } = newGame(seed, oneBasicDeck, starterDeck);
      const setup = state.setup!;
      for (const p of [0, 1] as const) {
        expect(state.players[p].hand).toHaveLength(7);
        expect(basicsInHand(state, p).length).toBeGreaterThan(0);
        expect(totalCards(state, p)).toBe(60);
        expect(state.players[p].prizes).toHaveLength(6);
      }
      if (events.some((e) => e.type === 'MULLIGAN')) sawMulligan = true;
      if (setup.extraDrawAvailable[1] > 0) sawExtra = true;
      // The opponent of a mulliganing player gets 2 extra cards per mulligan.
      expect(setup.extraDrawAvailable[1]).toBeLessThanOrEqual(2 * setup.mulligans[0]);
      expect(setup.extraDrawAvailable[1] % 2).toBe(0);
    }
    expect(sawMulligan).toBe(true);
    expect(sawExtra).toBe(true);
  });

  it('gives no extra draws when both players mulligan together', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { state, events } = newGame(seed, oneBasicDeck, oneBasicDeck);
      for (const e of events) {
        if (e.type === 'MULLIGAN' && !e.opponentMayDraw) {
          // both-failed rounds come in pairs and never grant extra cards
          expect(events.filter((x) => x.type === 'MULLIGAN' && !x.opponentMayDraw).length % 2).toBe(
            0,
          );
        }
      }
      const s = state.setup!;
      expect(s.extraDrawAvailable[0] % 2).toBe(0);
      expect(s.extraDrawAvailable[1] % 2).toBe(0);
    }
  });
});

describe('setup actions', () => {
  it('lets both players place creatures and starts the game', () => {
    const { state } = newGame(11);
    const done = completeSetup(state);
    expect(done.phase).toBe('playing');
    expect(done.turn).toBe(1);
    expect(done.currentPlayer).toBe(done.firstPlayer);
    for (const p of [0, 1] as const) {
      expect(done.players[p].active).not.toBeNull();
      expect(done.players[p].bench.length).toBeLessThanOrEqual(5);
      expect(totalCards(done, p)).toBe(60);
    }
  });

  it('does not mutate the previous state', () => {
    const { state } = newGame(11);
    const before = JSON.stringify(state);
    completeSetup(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects placing a non-basic or a card not in hand', () => {
    const { state } = newGame(11);
    const notInHand = applyAction(catalog, state, 0, {
      type: 'SETUP_PLACE',
      active: 'nope',
      bench: [],
    });
    expect(notInHand.ok).toBe(false);
    const nonBasic = state.players[0].hand.find((c) => !isBasicCreature(getCard(catalog, c.cardId)));
    if (nonBasic) {
      const r = applyAction(catalog, state, 0, { type: 'SETUP_PLACE', active: nonBasic.iid, bench: [] });
      expect(r.ok).toBe(false);
    }
  });

  it('rejects duplicate cards and an oversized bench', () => {
    const { state } = newGame(11);
    const b = basicsInHand(state, 0)[0]!;
    const r = applyAction(catalog, state, 0, { type: 'SETUP_PLACE', active: b.iid, bench: [b.iid] });
    expect(r.ok).toBe(false);
    const big = applyAction(catalog, state, 0, {
      type: 'SETUP_PLACE',
      active: b.iid,
      bench: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(big.ok).toBe(false);
  });

  it('forces the extra-draw decision before placing, and only once', () => {
    let found: GameState | null = null;
    let who: PlayerIndex = 0;
    for (let seed = 1; seed <= 300 && !found; seed++) {
      const { state } = newGame(seed, oneBasicDeck, starterDeck);
      if (state.setup!.extraDrawAvailable[1] > 0) {
        found = state;
        who = 1;
      }
    }
    expect(found).not.toBeNull();
    const state = found!;
    const b = basicsInHand(state, who)[0]!;
    const early = applyAction(catalog, state, who, { type: 'SETUP_PLACE', active: b.iid, bench: [] });
    expect(early.ok).toBe(false);

    const tooMany = applyAction(catalog, state, who, {
      type: 'SETUP_DRAW_EXTRA',
      count: state.setup!.extraDrawAvailable[who] + 1,
    });
    expect(tooMany.ok).toBe(false);

    const drawn = applyAction(catalog, state, who, { type: 'SETUP_DRAW_EXTRA', count: 1 });
    expect(drawn.ok).toBe(true);
    if (drawn.ok) {
      expect(drawn.value.state.players[who].hand).toHaveLength(8);
      const again = applyAction(catalog, drawn.value.state, who, {
        type: 'SETUP_DRAW_EXTRA',
        count: 1,
      });
      expect(again.ok).toBe(false);
    }
  });

  it('rejects in-game actions during setup', () => {
    const { state } = newGame(11);
    const r = applyAction(catalog, state, 0, { type: 'END_TURN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('WRONG_PHASE');
  });

  it('starts the first turn right after setup, with the first player drawing', () => {
    const { state } = newGame(11);
    const handBefore = state.players[state.firstPlayer].hand.length;
    const done = completeSetup(state);
    const first = done.players[done.firstPlayer];
    const second = done.players[done.firstPlayer === 0 ? 1 : 0];
    // placed creatures left the hand, but the first player drew one card
    const placedFirst = 1 + first.bench.length;
    expect(first.hand.length + placedFirst).toBe(handBefore + 1 + state.setup!.extraDrawAvailable[done.firstPlayer]);
    expect(second.deck.length).toBeGreaterThan(0);
    expect(done.turnStage).toBe('main');
  });
});
