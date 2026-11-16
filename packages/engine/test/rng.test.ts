import { describe, expect, it } from 'vitest';
import { Rng } from '../src/index.js';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('differs for different seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('produces values in [0, 1)', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('shuffle keeps every element exactly once', () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const shuffled = new Rng(7).shuffle([...items]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('coin flips are roughly fair', () => {
    const rng = new Rng(99);
    let heads = 0;
    for (let i = 0; i < 2000; i++) if (rng.coinFlip()) heads++;
    expect(heads > 800 && heads < 1200).toBe(true);
  });

  it('can resume from a saved state', () => {
    const a = new Rng(5);
    a.next();
    const b = new Rng(0);
    b.state = a.state;
    expect(b.next()).toBe(a.next());
  });
});
