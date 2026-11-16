import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../src/game/limiter.js';

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then blocks', () => {
    let now = 0;
    const b = new TokenBucket(3, 1, () => now);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });

  it('refills over time but never above capacity', () => {
    let now = 0;
    const b = new TokenBucket(2, 1, () => now);
    b.take();
    b.take();
    expect(b.take()).toBe(false);
    now += 1000;
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now += 60_000;
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
  });
});
