import { simulateGame, starterCatalog, starterDecks } from '@cardgame/engine';
import { describe, expect, it } from 'vitest';
import { actionSchema, clientMessageSchema } from '../src/game/protocol.js';

const ok = (v: unknown) => actionSchema.safeParse(v).success;

describe('actionSchema', () => {
  it('accepts every kind of action', () => {
    const valid = [
      { type: 'SETUP_DRAW_EXTRA', count: 2 },
      { type: 'SETUP_PLACE', active: 'p0-3', bench: ['p0-4'] },
      { type: 'PLAY_BASIC', iid: 'p0-1' },
      { type: 'ATTACH_POWER', iid: 'p0-1', target: { zone: 'active' } },
      { type: 'EVOLVE', iid: 'p0-1', target: { zone: 'bench', index: 2 } },
      { type: 'PLAY_ITEM', iid: 'p0-1' },
      { type: 'PLAY_ITEM', iid: 'p0-1', params: { target: { zone: 'active' } } },
      { type: 'USE_ABILITY', target: { zone: 'active' }, params: { target: { zone: 'bench', index: 0 } } },
      { type: 'RETREAT', benchIndex: 0, discard: ['p0-9'] },
      { type: 'ATTACK', attackIndex: 1 },
      { type: 'END_TURN' },
      { type: 'PROMOTE', benchIndex: 3 },
    ];
    for (const a of valid) expect([a.type, ok(a)]).toEqual([a.type, true]);
  });

  it('rejects malformed actions', () => {
    const invalid = [
      null,
      'END_TURN',
      {},
      { type: 'CHEAT' },
      { type: 'ATTACK' },
      { type: 'ATTACK', attackIndex: -1 },
      { type: 'ATTACK', attackIndex: 1.5 },
      { type: 'ATTACK', attackIndex: '1' },
      { type: 'PROMOTE', benchIndex: 5 },
      { type: 'PLAY_BASIC', iid: '' },
      { type: 'PLAY_BASIC', iid: 'x'.repeat(41) },
      { type: 'ATTACH_POWER', iid: 'a', target: { zone: 'hand' } },
      { type: 'ATTACH_POWER', iid: 'a', target: { zone: 'bench', index: 9 } },
      { type: 'ATTACH_POWER', iid: 'a' },
      { type: 'RETREAT', benchIndex: 0, discard: 'p0-1' },
      { type: 'RETREAT', benchIndex: 0, discard: Array.from({ length: 21 }, (_, i) => `c${i}`) },
      { type: 'SETUP_PLACE', active: 'a', bench: Array.from({ length: 11 }, (_, i) => `c${i}`) },
      { type: 'SETUP_DRAW_EXTRA', count: -1 },
    ];
    for (const a of invalid) expect([JSON.stringify(a), ok(a)]).toEqual([JSON.stringify(a), false]);
  });

  it('accepts every action the engine itself considers legal (so real moves are never blocked)', () => {
    let count = 0;
    simulateGame(starterCatalog, starterDecks.fire!, starterDecks.water!, {
      seed: 5,
      onStep: ({ action }) => {
        count++;
        const parsed = actionSchema.safeParse(JSON.parse(JSON.stringify(action)));
        expect([action.type, parsed.success]).toEqual([action.type, true]);
      },
    });
    expect(count).toBeGreaterThan(10);
  });
});

describe('clientMessageSchema', () => {
  const parse = (v: unknown) => clientMessageSchema.safeParse(v).success;

  it('accepts the four message types', () => {
    expect(parse({ type: 'ping' })).toBe(true);
    expect(parse({ type: 'game.sync' })).toBe(true);
    expect(parse({ type: 'game.forfeit' })).toBe(true);
    expect(parse({ type: 'game.action', action: { type: 'END_TURN' }, requestId: 'r1' })).toBe(true);
  });

  it('rejects unknown types, missing actions and oversized request ids', () => {
    expect(parse({ type: 'game.hack' })).toBe(false);
    expect(parse({ type: 'game.action' })).toBe(false);
    expect(parse({ type: 'game.action', action: { type: 'NOPE' } })).toBe(false);
    expect(parse({ type: 'game.action', action: { type: 'END_TURN' }, requestId: 'x'.repeat(65) })).toBe(false);
    expect(parse([])).toBe(false);
    expect(parse('ping')).toBe(false);
  });
});
