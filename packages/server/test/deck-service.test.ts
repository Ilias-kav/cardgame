import { starterCatalog, starterDecks } from '@cardgame/engine';
import { describe, expect, it } from 'vitest';
import { checkDeck, findUnknownCards, mergeEntries, toDetail, toSummary } from '../src/decks/service.js';

describe('mergeEntries', () => {
  it('sums duplicates and keeps first-seen order', () => {
    expect(
      mergeEntries([
        { cardId: 'a', count: 1 },
        { cardId: 'b', count: 2 },
        { cardId: 'a', count: 3 },
      ]),
    ).toEqual([
      { cardId: 'a', count: 4 },
      { cardId: 'b', count: 2 },
    ]);
  });
});

describe('findUnknownCards', () => {
  it('lists ids missing from the catalog', () => {
    expect(
      findUnknownCards(starterCatalog, [
        { cardId: 'embercub', count: 1 },
        { cardId: 'ghost', count: 1 },
      ]),
    ).toEqual(['ghost']);
  });
});

describe('checkDeck', () => {
  it('marks a full starter deck valid', () => {
    const r = checkDeck(starterCatalog, starterDecks.fire!);
    expect(r).toEqual({ cardCount: 60, valid: true, errors: [] });
  });

  it('marks drafts invalid with engine errors, without rejecting them', () => {
    const r = checkDeck(starterCatalog, [{ cardId: 'embercub', count: 2 }]);
    expect(r.valid).toBe(false);
    expect(r.cardCount).toBe(2);
    expect(r.errors.map((e) => e.code)).toContain('WRONG_SIZE');
  });

  it('reports too many copies', () => {
    const r = checkDeck(starterCatalog, [
      { cardId: 'embercub', count: 5 },
      { cardId: 'power-fire', count: 55 },
    ]);
    expect(r.errors.map((e) => e.code)).toEqual(['TOO_MANY_COPIES']);
  });

  it('treats an empty deck as invalid', () => {
    expect(checkDeck(starterCatalog, []).valid).toBe(false);
  });
});

describe('views', () => {
  const row = { id: 'd1', name: 'Test', createdAt: new Date(0), updatedAt: new Date(1000) };

  it('summary has the list fields only', () => {
    expect(toSummary(row, starterDecks.fire!, starterCatalog)).toEqual({
      id: 'd1',
      name: 'Test',
      cardCount: 60,
      valid: true,
      updatedAt: new Date(1000),
    });
  });

  it('detail includes cards, validity and errors', () => {
    const d = toDetail(row, [{ cardId: 'embercub', count: 1 }], starterCatalog);
    expect(d.cards).toEqual([{ cardId: 'embercub', count: 1 }]);
    expect(d.valid).toBe(false);
    expect(d.errors.length).toBeGreaterThan(0);
    expect(d.createdAt).toEqual(new Date(0));
  });
});
