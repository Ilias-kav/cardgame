import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (built into Node, no native dependency).
 * Stored format: scrypt$N$r$p$salt(base64)$hash(base64). The cost parameters
 * live in the string, so raising the cost later does not break old hashes.
 */
const KEY_LENGTH = 64;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** scrypt needs roughly 128 * N * r bytes; allow comfortable headroom. */
function maxMemory(n: number, r: number): number {
  return 256 * n * r;
}

export async function hashPassword(password: string, logN: number): Promise<string> {
  const n = 2 ** logN;
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: n,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: maxMemory(n, BLOCK_SIZE),
  });
  return [
    'scrypt',
    n,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** Returns false (never throws) for wrong passwords and for malformed stored hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;

  try {
    const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxMemory(n, r),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const dummyHashes = new Map<number, Promise<string>>();

/**
 * A valid hash nobody knows the password for. Login verifies against it when the
 * username does not exist, so "unknown user" takes as long as "wrong password".
 */
export function getDummyHash(logN: number): Promise<string> {
  let hash = dummyHashes.get(logN);
  if (!hash) {
    hash = hashPassword(randomBytes(16).toString('hex'), logN);
    dummyHashes.set(logN, hash);
  }
  return hash;
}
