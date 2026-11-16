import { createHash, randomBytes } from 'node:crypto';

/** A new unguessable session token (256 bits), safe to put in a cookie. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What we store in the database instead of the token itself. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
