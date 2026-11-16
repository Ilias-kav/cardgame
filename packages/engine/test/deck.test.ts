import { describe, expect, it } from 'vitest';
import { expandDeck, validateDeck, type DeckEntry } from '../src/index.js';
import { catalog, starterDeck } from './fixtures.js';

const codes = (entries: DeckEntry[]) => validateDeck(catalog, entries).map((e) => e.code);

describe('validateDeck', () => {
  it('accepts a valid 60-card deck', () => {
    expect(codes(starterDeck)).toEqual([]);
  });

  it('rejects wrong deck size', () => {
    expect(codes([...starterDeck, { cardId: 'power-fire', count: 1 }])).toContain('WRONG_SIZE');
    expect(codes(starterDeck.slice(0, 2))).toContain('WRONG_SIZE');
  });

  it('rejects more than 4 copies of a non-power card', () => {
    const deck: DeckEntry[] = [
      { cardId: 'sparky', count: 5 },
      { cardId: 'power-fire', count: 55 },
    ];
    expect(codes(deck)).toEqual(['TOO_MANY_COPIES']);
  });

  it('counts duplicate entries of the same card together', () => {
    const deck: DeckEntry[] = [
      { cardId: 'sparky', count: 3 },
      { cardId: 'sparky', count: 2 },
      { cardId: 'power-fire', count: 55 },
    ];
    expect(codes(deck)).toEqual(['TOO_MANY_COPIES']);
  });

  it('allows unlimited normal power cards', () => {
    const deck: DeckEntry[] = [
      { cardId: 'sparky', count: 4 },
      { cardId: 'power-fire', count: 56 },
    ];
    expect(codes(deck)).toEqual([]);
  });

  it('limits double neutral to 4 copies', () => {
    const deck: DeckEntry[] = [
      { cardId: 'sparky', count: 4 },
      { cardId: 'power-double-neutral', count: 5 },
      { cardId: 'power-fire', count: 51 },
    ];
    expect(codes(deck)).toEqual(['TOO_MANY_COPIES']);
  });

  it('rejects unknown cards and bad counts', () => {
    expect(codes([...starterDeck, { cardId: 'nope', count: 1 }])).toContain('UNKNOWN_CARD');
    expect(codes([{ cardId: 'sparky', count: 0 }])).toContain('INVALID_COUNT');
    expect(codes([{ cardId: 'sparky', count: 1.5 }])).toContain('INVALID_COUNT');
  });

  it('requires at least one basic creature', () => {
    expect(codes([{ cardId: 'power-fire', count: 60 }])).toEqual(['NO_BASIC_CREATURE']);
  });
});

describe('expandDeck', () => {
  it('flattens entries', () => {
    expect(
      expandDeck([
        { cardId: 'a', count: 2 },
        { cardId: 'b', count: 1 },
      ]),
    ).toEqual(['a', 'a', 'b']);
  });
});
