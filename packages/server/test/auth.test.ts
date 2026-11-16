import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeExpiredSessions } from '../src/auth/sessions.js';
import { sessions, users } from '../src/db/schema.js';
import { PASSWORD, createTestApp, registerUser, resetDb, sessionCookie } from './helpers.js';

describe('authentication', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  const post = (url: string, payload: unknown, cookies?: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload: payload as object, ...(cookies ? { cookies } : {}) });
  const me = (sid?: string) =>
    app.inject({ method: 'GET', url: '/api/me', ...(sid ? { cookies: { sid } } : {}) });

  describe('register', () => {
    it('creates the account, logs the user in and sets a safe cookie', async () => {
      const res = await post('/api/auth/register', { username: 'alice', password: PASSWORD });
      expect(res.statusCode).toBe(201);
      expect(res.json().user.username).toBe('alice');
      const setCookie = String(res.headers['set-cookie']);
      expect(setCookie).toContain('sid=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      expect((await me(sessionCookie(res))).statusCode).toBe(200);
    });

    it('never stores the password or the raw session token', async () => {
      const res = await post('/api/auth/register', { username: 'alice', password: PASSWORD });
      const sid = sessionCookie(res)!;
      const [user] = await app.db.select().from(users);
      expect(user!.passwordHash.startsWith('scrypt$')).toBe(true);
      expect(user!.passwordHash.includes(PASSWORD)).toBe(false);
      const [session] = await app.db.select().from(sessions);
      expect(session!.tokenHash).not.toBe(sid);
      expect(session!.tokenHash).toHaveLength(64);
    });

    it('rejects a taken username, ignoring capitalisation', async () => {
      await registerUser(app, 'alice');
      const res = await post('/api/auth/register', { username: 'ALICE', password: PASSWORD });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('USERNAME_TAKEN');
    });

    it('rejects invalid usernames and weak passwords with 400', async () => {
      for (const body of [
        { username: 'ab', password: PASSWORD },
        { username: 'has space', password: PASSWORD },
        { username: 'alice', password: 'short' },
        { username: 'alice' },
        {},
      ]) {
        const res = await post('/api/auth/register', body);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('login', () => {
    it('logs in with the right credentials, ignoring username capitalisation', async () => {
      await registerUser(app, 'Alice');
      const res = await post('/api/auth/login', { username: 'alice', password: PASSWORD });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.username).toBe('Alice');
      expect(sessionCookie(res)).toBeTruthy();
    });

    it('answers a wrong password and an unknown user identically', async () => {
      await registerUser(app, 'alice');
      const wrongPassword = await post('/api/auth/login', { username: 'alice', password: 'not-the-password' });
      const unknownUser = await post('/api/auth/login', { username: 'nobody', password: 'not-the-password' });
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownUser.statusCode).toBe(401);
      expect(wrongPassword.json()).toEqual(unknownUser.json());
      expect(wrongPassword.json().error.code).toBe('INVALID_CREDENTIALS');
      expect(sessionCookie(wrongPassword)).toBeUndefined();
    });
  });

  describe('sessions', () => {
    it('GET /api/me needs a valid session', async () => {
      expect((await me()).statusCode).toBe(401);
      expect((await me('not-a-real-token')).statusCode).toBe(401);
      const sid = await registerUser(app);
      const res = await me(sid);
      expect(res.statusCode).toBe(200);
      expect(res.json().user.username).toBe('alice');
    });

    it('logout ends the session, and works even when not logged in', async () => {
      const sid = await registerUser(app);
      const out = await post('/api/auth/logout', {}, { sid });
      expect(out.statusCode).toBe(204);
      expect((await me(sid)).statusCode).toBe(401);
      expect((await post('/api/auth/logout', {})).statusCode).toBe(204);
    });

    it('rejects expired sessions and the purge removes them', async () => {
      const sid = await registerUser(app);
      await app.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
      const res = await me(sid);
      expect(res.statusCode).toBe(401);
      expect(String(res.headers['set-cookie'])).toContain('sid=;'); // stale cookie cleared
      expect(await purgeExpiredSessions(app.db)).toBe(1);
      expect(await app.db.select().from(sessions)).toHaveLength(0);
    });

    it('keeps one user\'s sessions independent and removes them with the user', async () => {
      const a = await registerUser(app, 'alice');
      const b = await registerUser(app, 'bob');
      await post('/api/auth/logout', {}, { sid: a });
      expect((await me(b)).statusCode).toBe(200);
      await app.db.delete(users).where(eq(users.username, 'bob'));
      expect((await me(b)).statusCode).toBe(401);
      const left = await app.db.execute(sql`select count(*)::int as n from sessions`);
      expect((left[0] as { n: number }).n).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('answers 429 after too many login attempts', async () => {
      const limited = await createTestApp({ config: { rateLimitMax: 3, rateLimitWindow: '1 minute' } });
      try {
        const attempt = () =>
          limited.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'x', password: 'y' } });
        for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
        const blocked = await attempt();
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json().error.code).toBe('RATE_LIMITED');
      } finally {
        await limited.close();
      }
    });
  });
});
