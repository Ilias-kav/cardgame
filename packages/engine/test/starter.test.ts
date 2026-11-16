import { describe, expect, it } from 'vitest';
import { legalActions, starterCatalog, starterDecks, validateDeck } from '../src/index.js';
import { catalog } from './fixtures.js';
import { creature, makeState } from './helpers.js';

describe('placeholder card set', () => {
  it('has 20-30 cards', () => {
    const n = Object.keys(starterCatalog).length;
    expect(n >= 20 && n <= 30).toBe(true);
  });

  it('every starter deck is valid', () => {
    for (const [name, deck] of Object.entries(starterDecks)) {
      expect([name, validateDeck(starterCatalog, deck).map((e) => e.message)]).toEqual([name, []]);
    }
  });

  it('every evolution points at an existing creature of the previous stage', () => {
    const creatures = Object.values(starterCatalog).filter((c) => c.kind === 'creature');
    for (const c of creatures) {
      if (c.kind !== 'creature' || c.stage === 'basic') continue;
      const parent = creatures.find((p) => p.kind === 'creature' && p.name === c.evolvesFrom);
      expect(parent?.kind === 'creature' && parent.stage).toBe(c.stage === 'stage1' ? 'basic' : 'stage1');
    }
  });

  it('every attack and effect handler is well formed', () => {
    for (const c of Object.values(starterCatalog)) {
      if (c.kind !== 'creature') continue;
      expect(c.attacks.length).toBeGreaterThan(0);
      expect(c.hp).toBeGreaterThan(0);
      for (const a of c.attacks) expect(a.cost.length).toBeGreaterThan(0);
    }
  });
});

describe('legalActions', () => {
  it('lists only actions the engine accepts and always offers END_TURN in the main phase', () => {
    const s = makeState({
      p0: { active: creature('bruiser', { attached: ['power-fire'] }), hand: ['sparky', 'power-fire', 'potion'] },
    });
    const legal = legalActions(catalog, s, 0);
    const types = new Set(legal.map((a) => a.type));
    expect(types.has('END_TURN')).toBe(true);
    expect(types.has('ATTACK')).toBe(true);
    expect(types.has('PLAY_BASIC')).toBe(true);
    expect(types.has('ATTACH_POWER')).toBe(true);
    expect(types.has('RETREAT')).toBe(false); // empty bench
    expect(legalActions(catalog, s, 1)).toHaveLength(0); // not their turn
  });
});
