import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password.js';
import { SESSION_COOKIE, createSession, deleteSession } from '../auth/sessions.js';
import type { Config } from '../config.js';
import { users } from '../db/schema.js';
import { AppError, errorBody } from '../errors.js';
import { loginSchema, registerSchema } from '../schemas.js';

interface Options {
  config: Config;
}

export const authRoutes: FastifyPluginAsync<Options> = async (app, { config }) => {
  const { db } = app;
  const limit = { config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindow } } };

  function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      expires: expiresAt,
    });
  }

  // Creating an account also logs the new user in.
  app.post('/api/auth/register', limit, async (req, reply) => {
    const { username, password } = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(password, config.scryptLogN);

    // ON CONFLICT DO NOTHING: a taken username (any capitalisation) returns no row.
    const inserted = await db
      .insert(users)
      .values({ username, passwordHash })
      .onConflictDoNothing()
      .returning({ id: users.id, username: users.username });
    const user = inserted[0];
    if (!user) throw new AppError(409, 'USERNAME_TAKEN', 'That username is already taken');

    const session = await createSession(db, user.id, config.sessionTtlDays);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({ user });
  });

  app.post('/api/auth/login', limit, async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);

    const rows = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
      .limit(1);
    const user = rows[0];

    // Always do one password check, even for unknown users, so timing reveals nothing.
    const passwordOk = await verifyPassword(
      password,
      user ? user.passwordHash : await getDummyHash(config.scryptLogN),
    );
    if (!user || !passwordOk) {
      return reply
        .code(401)
        .send(errorBody('INVALID_CREDENTIALS', 'Wrong username or password'));
    }

    const session = await createSession(db, user.id, config.sessionTtlDays);
    setSessionCookie(reply, session.token, session.expiresAt);
    return { user: { id: user.id, username: user.username } };
  });

  // Idempotent: works (and returns 204) even when nobody is logged in.
  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/me', { preHandler: app.requireUser }, async (req) => {
    return { user: req.user };
  });
};

