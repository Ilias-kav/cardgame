import { describe, expect, it } from 'vitest';
import { getDummyHash, hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery', 10);
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('wrong-password-here', hash)).toBe(false);
  });

  it('uses a fresh salt every time and never contains the password', async () => {
    const a = await hashPassword('same-password-123', 10);
    const b = await hashPassword('same-password-123', 10);
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(a.includes('same-password-123')).toBe(false);
  });

  it('keeps the cost parameters inside the hash, so old hashes keep working', async () => {
    const cheap = await hashPassword('pw-for-cost-test', 10);
    expect(cheap.split('$')[1]).toBe(String(2 ** 10));
    expect(await verifyPassword('pw-for-cost-test', cheap)).toBe(true);
  });

  it('treats malformed stored hashes as a mismatch instead of crashing', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$1$2$3', 'bcrypt$1$2$3$4$5', 'scrypt$x$8$1$AAAA$AAAA']) {
      expect(await verifyPassword('whatever', bad)).toBe(false);
    }
  });

  it('normalises unicode so equivalent passwords match', async () => {
    const hash = await hashPassword('caf\u00e9-password', 10); // precomposed é
    expect(await verifyPassword('cafe\u0301-password', hash)).toBe(true); // e + combining accent
  });

  it('provides a dummy hash that no password matches, cached per cost', async () => {
    const dummy = await getDummyHash(10);
    expect(await getDummyHash(10)).toBe(dummy);
    expect(await verifyPassword('anything-at-all', dummy)).toBe(false);
  });
});
