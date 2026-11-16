import { describe, expect, it } from 'vitest';
import { parseRoute, paths } from '../src/router.js';

describe('parseRoute', () => {
  it('maps hashes to pages', () => {
    expect(parseRoute('')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/lobby')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/decks')).toEqual({ name: 'decks' });
    expect(parseRoute('#/decks/new')).toEqual({ name: 'deck', id: 'new' });
    expect(parseRoute('#/decks/abc-123')).toEqual({ name: 'deck', id: 'abc-123' });
    expect(parseRoute('#/game')).toEqual({ name: 'game' });
    expect(parseRoute('#/game/')).toEqual({ name: 'game' });
  });

  it('decodes ids and rejects unknown paths', () => {
    expect(parseRoute('#/decks/a%20b')).toEqual({ name: 'deck', id: 'a b' });
    expect(parseRoute('#/nope')).toEqual({ name: 'notfound' });
    expect(parseRoute('#/decks/a/b')).toEqual({ name: 'notfound' });
    expect(parseRoute('#/game/extra')).toEqual({ name: 'notfound' });
  });

  it('paths round-trip through parseRoute', () => {
    expect(parseRoute(paths.deck('x y'))).toEqual({ name: 'deck', id: 'x y' });
    expect(parseRoute(paths.newDeck)).toEqual({ name: 'deck', id: 'new' });
    expect(parseRoute(paths.game)).toEqual({ name: 'game' });
  });
});
