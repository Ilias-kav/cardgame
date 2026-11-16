import type { GameEvent } from '@cardgame/engine';
import { describe, expect, it } from 'vitest';
import { fxFromEntries, slotKey, soundForOutcome, soundsFromEvents } from '../src/game/effects.js';

const entries = (events: GameEvent[], start = 1) => events.map((event, i) => ({ id: start + i, event }));

describe('slotKey', () => {
  it('names slots from the viewer\'s point of view', () => {
    expect(slotKey(0, 0, { zone: 'active' })).toBe('me-active');
    expect(slotKey(0, 1, { zone: 'active' })).toBe('opp-active');
    expect(slotKey(1, 1, { zone: 'bench', index: 3 })).toBe('me-bench-3');
    expect(slotKey(1, 0, { zone: 'bench', index: 0 })).toBe('opp-bench-0');
  });
});

describe('fxFromEntries', () => {
  it('shows damage, healing, knockouts and statuses on the right slots', () => {
    const fx = fxFromEntries(
      entries([
        { type: 'DAMAGE', player: 1, target: { zone: 'active' }, amount: 30, source: 'attack' },
        { type: 'CREATURE_HEALED', player: 0, target: { zone: 'bench', index: 1 }, amount: 20 },
        { type: 'CREATURE_KNOCKED_OUT', player: 1, cardIds: ['embercub'] },
        { type: 'STATUS_APPLIED', player: 0, status: 'poisoned' },
      ]),
      0,
    );
    expect(fx).toEqual([
      { id: 1, key: 'opp-active', kind: 'damage', text: '−30' },
      { id: 2, key: 'me-bench-1', kind: 'heal', text: '+20' },
      { id: 3, key: 'opp-active', kind: 'ko', text: 'KO!' },
      { id: 4, key: 'me-active', kind: 'status', text: 'poisoned' },
    ]);
  });

  it('ignores events with nothing to show, and zero healing', () => {
    expect(
      fxFromEntries(
        entries([
          { type: 'CARD_DRAWN', player: 0, count: 1 },
          { type: 'TURN_STARTED', player: 1, turn: 2 },
          { type: 'CREATURE_HEALED', player: 0, target: { zone: 'active' }, amount: 0 },
        ]),
        0,
      ),
    ).toEqual([]);
  });

  it('uses the log entry id, so every event animates on its own', () => {
    const fx = fxFromEntries(entries([{ type: 'DAMAGE', player: 0, target: { zone: 'active' }, amount: 10, source: 'poison' }], 41), 0);
    expect(fx[0]!.id).toBe(41);
  });
});

describe('soundsFromEvents', () => {
  const dmg: GameEvent = { type: 'DAMAGE', player: 1, target: { zone: 'active' }, amount: 10, source: 'attack' };

  it('plays each kind of sound at most once per batch', () => {
    expect(soundsFromEvents([dmg, dmg, dmg], 0)).toEqual(['hit']);
  });

  it('a knockout replaces the hit sound', () => {
    expect(soundsFromEvents([dmg, { type: 'CREATURE_KNOCKED_OUT', player: 1, cardIds: [] }], 0)).toEqual(['ko']);
  });

  it('signals your own turn, not the opponent\'s, and mid-game coin flips but not the opening one', () => {
    expect(soundsFromEvents([{ type: 'TURN_STARTED', player: 0, turn: 3 }], 0)).toEqual(['turn']);
    expect(soundsFromEvents([{ type: 'TURN_STARTED', player: 1, turn: 4 }], 0)).toEqual([]);
    expect(soundsFromEvents([{ type: 'COIN_FLIP', purpose: 'attack_effect', heads: true, player: 0 }], 0)).toEqual(['coin']);
    expect(soundsFromEvents([{ type: 'COIN_FLIP', purpose: 'first_player', heads: true, winner: 0 }], 0)).toEqual([]);
    expect(soundsFromEvents([{ type: 'CREATURE_HEALED', player: 0, target: { zone: 'active' }, amount: 10 }], 0)).toEqual(['heal']);
  });

  it('picks win/lose from the outcome, and nothing for draws', () => {
    expect(soundForOutcome({ winner: 0, reason: 'prizes' }, 0)).toBe('win');
    expect(soundForOutcome({ winner: 1, reason: 'timeout' }, 0)).toBe('lose');
    expect(soundForOutcome({ winner: null, reason: 'abandoned' }, 0)).toBeNull();
    expect(soundForOutcome(null, 0)).toBeNull();
  });
});
