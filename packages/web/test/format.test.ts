import { starterCatalog, type GameEvent } from '@cardgame/engine';
import { describe, expect, it } from 'vitest';
import { describeOutcome, formatEvent, thirdPerson } from '../src/game/format.js';

const ctx = { catalog: starterCatalog, mySeat: 0 as const, names: ['alice', 'bob'] as [string, string] };
const text = (e: GameEvent) => formatEvent(e, ctx)?.text;

describe('formatEvent', () => {
  it('uses "You" for yourself and the username for the opponent, with matching verbs', () => {
    expect(text({ type: 'CARD_DRAWN', player: 0, count: 1 })).toBe('You draw 1 card.');
    expect(text({ type: 'CARD_DRAWN', player: 1, count: 2 })).toBe('bob draws 2 cards.');
    expect(text({ type: 'ATTACK_DECLARED', player: 1, attack: 'Zap' })).toBe('bob attacks with Zap!');
    expect(text({ type: 'ATTACK_DECLARED', player: 0, attack: 'Zap' })).toBe('You attack with Zap!');
  });

  it('looks card names up in the catalog', () => {
    expect(text({ type: 'CREATURE_PLAYED', player: 0, cardId: 'embercub', benchIndex: 0 })).toBe('You play Embercub to the bench.');
    expect(text({ type: 'EVOLVED', player: 1, cardId: 'blazewolf', target: { zone: 'bench', index: 1 } })).toBe(
      'bob evolves bench slot 2 into Blazewolf.',
    );
  });

  it('describes damage, statuses and knockouts from either side', () => {
    expect(text({ type: 'DAMAGE', player: 0, target: { zone: 'active' }, amount: 20, source: 'poison' })).toBe(
      'Your creature takes 20 damage from poison.',
    );
    expect(text({ type: 'STATUS_APPLIED', player: 1, status: 'asleep' })).toBe("bob's creature is now asleep.");
    expect(text({ type: 'CREATURE_KNOCKED_OUT', player: 1, cardIds: ['pondling', 'tidewyrm'] })).toBe(
      "bob's Pondling / Tidewyrm is knocked out!",
    );
  });

  it('marks turn headers and coin flips', () => {
    expect(formatEvent({ type: 'TURN_STARTED', player: 1, turn: 4 }, ctx)).toEqual({ text: "Turn 4: bob's turn", tone: 'turn' });
    expect(formatEvent({ type: 'TURN_STARTED', player: 0, turn: 5 }, ctx)?.text).toBe('Turn 5: your turn');
    expect(text({ type: 'COIN_FLIP', purpose: 'first_player', heads: true, winner: 0 })).toBe('Coin flip: heads. You go first.');
    expect(text({ type: 'COIN_FLIP', purpose: 'sleep_wake', heads: false, player: 1 })).toBe(
      'bob flips a coin for waking up: tails.',
    );
  });

  it('words a declined extra draw sensibly', () => {
    expect(text({ type: 'EXTRA_DRAW', player: 1, count: 0 })).toBe('bob chose not to draw extra cards.');
    expect(text({ type: 'EXTRA_DRAW', player: 0, count: 2 })).toBe('You draw 2 extra cards.');
  });

  it('skips noise events and falls back to the id for unknown cards', () => {
    expect(formatEvent({ type: 'TURN_ENDED', player: 0 }, ctx)).toBeNull();
    expect(formatEvent({ type: 'GAME_STARTED', firstPlayer: 0 }, ctx)).toBeNull();
    expect(text({ type: 'ITEM_PLAYED', player: 0, cardId: 'mystery-card' })).toBe('You play mystery-card.');
  });

  it('can format every kind of event the engine produces (no crashes)', () => {
    const samples: GameEvent[] = [
      { type: 'MULLIGAN', player: 1, revealedHand: ['potion', 'power-fire'], opponentMayDraw: true },
      { type: 'EXTRA_DRAW', player: 0, count: 2 },
      { type: 'SETUP_PLACED', player: 1 },
      { type: 'POWER_ATTACHED', player: 0, cardId: 'power-fire', target: { zone: 'active' } },
      { type: 'ABILITY_USED', player: 0, target: { zone: 'active' } },
      { type: 'RETREATED', player: 0, benchIndex: 0 },
      { type: 'RETREAT_FAILED', player: 1 },
      { type: 'PROMOTED', player: 1, benchIndex: 2 },
      { type: 'CREATURE_HEALED', player: 0, target: { zone: 'active' }, amount: 10 },
      { type: 'STATUS_REMOVED', player: 0, status: 'poisoned' },
      { type: 'PRIZE_TAKEN', player: 0 },
      { type: 'GAME_OVER', result: { winner: 1, reason: 'prizes' } },
      { type: 'GAME_OVER', result: { winner: null, reason: 'sudden_death_rematch' } },
    ];
    expect(samples.every((e) => formatEvent(e, ctx) !== null)).toBe(true);
  });
});

describe('verb agreement', () => {
  it('adds -s or -es like English does', () => {
    expect(['draw', 'attach', 'attack', 'retreat', 'show', 'flip', 'pass'].map(thirdPerson)).toEqual([
      'draws', 'attaches', 'attacks', 'retreats', 'shows', 'flips', 'passes',
    ]);
    expect(text({ type: 'POWER_ATTACHED', player: 1, cardId: 'power-water', target: { zone: 'active' } })).toBe(
      'bob attaches Water Power to the active creature.',
    );
  });
});

describe('describeOutcome', () => {
  it('says who won and why', () => {
    expect(describeOutcome({ winner: 0, reason: 'prizes' }, 0, ['alice', 'bob'])).toBe('You win: all prize cards were taken.');
    expect(describeOutcome({ winner: 1, reason: 'timeout' }, 0, ['alice', 'bob'])).toBe('bob wins: a player ran out of time.');
    expect(describeOutcome({ winner: null, reason: 'abandoned' }, 0, ['alice', 'bob'])).toContain('No winner');
    expect(describeOutcome({ winner: null, reason: 'sudden_death_rematch' }, 0, ['alice', 'bob'])).toContain('Sudden death');
  });
});
