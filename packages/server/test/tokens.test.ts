import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from '../src/auth/tokens.js';

describe('session tokens', () => {
  it('generates long, unique, cookie-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t.length).toBeGreaterThanOrEqual(43); // 32 bytes in base64url
      expect(/^[A-Za-z0-9_-]+$/.test(t)).toBe(true);
    }
  });

  it('hashes deterministically and never returns the token itself', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
    expect(hashToken(t)).toHaveLength(64);
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });
});
