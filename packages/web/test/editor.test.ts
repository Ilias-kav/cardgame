import { starterCatalog, starterDecks } from '@cardgame/engine';
import { describe, expect, it } from 'vitest';
import {
  addCard,
  cardSummary,
  copyLimit,
  deckProblems,
  filterCards,
  fromEntries,
  kindTotals,
  removeCard,
  sortCards,
  toEntries,
  totalCards,
} from '../src/deck/editor.js';

const c = starterCatalog;
const all = Object.values(c);

describe('adding and removing cards', () => {
  it('stops at 4 copies for normal cards but not for power cards', () => {
    let counts = {};
    for (let i = 0; i < 6; i++) counts = addCard(counts, c.embercub!);
    expect(counts).toEqual({ embercub: 4 });
    let power = {};
    for (let i = 0; i < 30; i++) power = addCard(power, c['power-fire']!);
    expect(power).toEqual({ 'power-fire': 30 });
    expect(copyLimit(c['power-double-neutral']!)).toBe(4);
    expect(copyLimit(c['power-fire']!)).toBe(Infinity);
  });

  it('removing the last copy drops the entry; removing a missing card changes nothing', () => {
    expect(removeCard({ a: 2 }, 'a')).toEqual({ a: 1 });
    expect(removeCard({ a: 1 }, 'a')).toEqual({});
    const same = { a: 1 };
    expect(removeCard(same, 'zzz')).toBe(same);
  });

  it('does not mutate the previous counts', () => {
    const before = { embercub: 1 };
    addCard(before, c.embercub!);
    removeCard(before, 'embercub');
    expect(before).toEqual({ embercub: 1 });
  });
});

describe('conversion and totals', () => {
  it('converts to and from entries (sorted, zero counts dropped)', () => {
    expect(toEntries({ b: 2, a: 1, z: 0 })).toEqual([{ cardId: 'a', count: 1 }, { cardId: 'b', count: 2 }]);
    expect(fromEntries([{ cardId: 'a', count: 1 }, { cardId: 'a', count: 2 }])).toEqual({ a: 3 });
  });

  it('counts cards and kinds', () => {
    const counts = fromEntries(starterDecks.fire!);
    expect(totalCards(counts)).toBe(60);
    const k = kindTotals(c, counts);
    expect(k.creature + k.item + k.power).toBe(60);
    expect(k.power).toBe(38); // 34 fire + 4 double neutral
  });
});

describe('deckProblems', () => {
  it('uses the engine rules', () => {
    expect(deckProblems(c, fromEntries(starterDecks.fire!))).toEqual([]);
    const codes = deckProblems(c, { embercub: 2 }).map((p) => p.code);
    expect(codes).toContain('WRONG_SIZE');
    expect(deckProblems(c, {}).map((p) => p.code)).toContain('NO_BASIC_CREATURE');
    expect(deckProblems(c, { embercub: 5, 'power-fire': 55 }).map((p) => p.code)).toEqual(['TOO_MANY_COPIES']);
  });
});

describe('catalog browsing', () => {
  it('sorts creatures (basic first), then items, then power cards', () => {
    const sorted = sortCards(all);
    const kinds = sorted.map((x) => x.kind);
    expect(kinds.indexOf('item')).toBeGreaterThan(kinds.lastIndexOf('creature'));
    expect(kinds.indexOf('power')).toBeGreaterThan(kinds.lastIndexOf('item'));
    const firstStage1 = sorted.findIndex((x) => x.kind === 'creature' && x.stage === 'stage1');
    const lastBasic = sorted.map((x) => x.kind === 'creature' && x.stage === 'basic').lastIndexOf(true);
    expect(lastBasic).toBeLessThan(firstStage1);
  });

  it('filters by kind, nature and text', () => {
    const f = (o: Partial<Parameters<typeof filterCards>[1]>) => filterCards(all, { kind: 'all', text: '', nature: 'all', ...o }).map((x) => x.id);
    expect(f({ kind: 'item' }).sort()).toEqual(['deep-study', 'potion', 'quick-draw', 'super-potion']);
    expect(f({ text: 'EMBER' })).toEqual(['embercub']);
    expect(f({ nature: 'fire' }).sort()).toEqual(['blazewolf', 'embercub', 'infernowolf', 'power-fire']);
    expect(f({ kind: 'power', nature: 'water' })).toEqual(['power-water']);
    expect(f({ text: 'zzz' })).toEqual([]);
  });

  it('summarises each card kind on one line', () => {
    expect(cardSummary(c.embercub!)).toContain('50 HP');
    expect(cardSummary(c.potion!)).toBe('Heal 20 damage from one of your creatures.');
    expect(cardSummary(c['power-double-neutral']!)).toContain('two neutral');
    expect(cardSummary(c['power-fire']!)).toBe('fire power');
  });
});
