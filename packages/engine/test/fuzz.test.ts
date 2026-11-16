import { describe, expect, it } from 'vitest';
import { applyAction, simulateGame, starterCatalog, starterDecks, type BotStyle } from '../src/index.js';
import { checkInvariants } from './invariants.js';

const deckNames = Object.keys(starterDecks);

function run(seed: number, styles: [BotStyle, BotStyle]) {
  const a = starterDecks[deckNames[seed % deckNames.length]!]!;
  const b = starterDecks[deckNames[(seed * 7 + 1) % deckNames.length]!]!;
  let lastTurn = 0;
  const result = simulateGame(starterCatalog, a, b, {
    seed,
    styles,
    onStep: ({ before, after, player, action, events }) => {
      checkInvariants(starterCatalog, after, `seed ${seed}, ${action.type}`);
      // The engine never changes the state it was given.
      const again = applyAction(starterCatalog, before, player, action);
      expect(again.ok).toBe(true);
      if (again.ok) {
        expect(JSON.stringify(again.value.state)).toBe(JSON.stringify(after));
        expect(again.value.events).toEqual(events);
      }
      expect(after.turn).toBeGreaterThanOrEqual(lastTurn);
      lastTurn = after.turn;
    },
  });
  return result;
}

describe('random-play fuzzing', () => {
  it('aggressive bots finish games without breaking any invariant', () => {
    let prizeWins = 0;
    let noCreatureWins = 0;
    let deckOuts = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const r = run(seed, ['aggressive', 'aggressive']);
      expect(r.finished).toBe(true);
      const res = r.state.result!;
      if (res.winner !== null) {
        if (res.reason === 'prizes') prizeWins++;
        if (res.reason === 'no_creatures') noCreatureWins++;
        if (res.reason === 'deck_out') deckOuts++;
      }
    }
    // The bots should reach real endings, not only stall until decks run out.
    expect(prizeWins + noCreatureWins).toBeGreaterThan(0);
    expect(prizeWins + noCreatureWins + deckOuts).toBeGreaterThan(10);
  });

  it('uniformly random bots (odd corner cases) never break invariants or get stuck', () => {
    for (let seed = 100; seed < 112; seed++) {
      const r = run(seed, ['uniform', 'uniform']);
      expect(r.finished).toBe(true);
    }
  });

  it('is deterministic: same seeds, same game', () => {
    const a = run(7, ['aggressive', 'aggressive']);
    const b = run(7, ['aggressive', 'aggressive']);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.events).toEqual(b.events);
  });
});
