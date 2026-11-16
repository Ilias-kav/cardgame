import { describe, expect, it } from 'vitest';
import { deckInputSchema, loginSchema, registerSchema } from '../src/schemas.js';

describe('registerSchema', () => {
  const ok = { username: 'alice_01', password: 'a-long-enough-password' };

  it('accepts a valid registration', () => {
    expect(registerSchema.safeParse(ok).success).toBe(true);
  });

  it('enforces username rules', () => {
    for (const username of ['ab', 'a'.repeat(21), 'has space', 'dash-ed', 'émile', '']) {
      expect(registerSchema.safeParse({ ...ok, username }).success).toBe(false);
    }
    for (const username of ['abc', 'a'.repeat(20), 'Under_Score_9']) {
      expect(registerSchema.safeParse({ ...ok, username }).success).toBe(true);
    }
  });

  it('requires a password of at least 10 characters and at most 128', () => {
    expect(registerSchema.safeParse({ ...ok, password: '123456789' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, password: '1234567890' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...ok, password: 'x'.repeat(129) }).success).toBe(false);
  });

  it('rejects missing or non-string fields', () => {
    expect(registerSchema.safeParse(undefined).success).toBe(false);
    expect(registerSchema.safeParse({ username: 5, password: 6 }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('does not re-check password strength', () => {
    expect(loginSchema.safeParse({ username: 'a', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ username: 'a', password: '' }).success).toBe(false);
  });
});

describe('deckInputSchema', () => {
  it('trims the name and accepts card lists', () => {
    const r = deckInputSchema.parse({ name: '  My deck ', cards: [{ cardId: 'embercub', count: 4 }] });
    expect(r.name).toBe('My deck');
  });

  it('rejects bad names', () => {
    expect(deckInputSchema.safeParse({ name: '   ', cards: [] }).success).toBe(false);
    expect(deckInputSchema.safeParse({ name: 'x'.repeat(41), cards: [] }).success).toBe(false);
  });

  it('rejects non-positive or non-integer counts', () => {
    for (const count of [0, -1, 1.5, 1000, '4']) {
      expect(deckInputSchema.safeParse({ name: 'd', cards: [{ cardId: 'a', count }] }).success).toBe(false);
    }
  });
});
