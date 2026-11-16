import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from '../errors.js';
import type { Db } from '../db/client.js';
import { SESSION_COOKIE, findSessionUser } from './sessions.js';

/** Builds the `requireUser` preHandler: loads the session user or answers 401. */
export function makeRequireUser(db: Db) {
  return async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await findSessionUser(db, token) : null;
    if (!user) {
      // A stale cookie (expired or logged out elsewhere) is removed from the browser.
      if (token) reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(401).send(errorBody('UNAUTHENTICATED', 'You need to log in'));
    }
    req.user = user;
    return undefined;
  };
}
