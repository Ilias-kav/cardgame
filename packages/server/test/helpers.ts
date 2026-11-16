import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp, type BuildAppOptions } from '../src/app.js';

export async function createTestApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false, ...options });
  await app.ready();
  return app;
}

/** Empties all user-generated tables (the seeded `cards` table stays). */
export async function resetDb(app: FastifyInstance): Promise<void> {
  await app.db.execute(
    sql`truncate table users, sessions, decks, deck_cards, games, game_players, game_actions cascade`,
  );
}

export function sessionCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === 'sid')?.value;
}

export const PASSWORD = 'correct-horse-battery';

/** Registers a user and returns their session cookie value. */
export async function registerUser(
  app: FastifyInstance,
  username = 'alice',
  password = PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const sid = sessionCookie(res);
  if (!sid) throw new Error('register did not set a session cookie');
  return sid;
}

/** Shorthand for an authenticated request. */
export function as(app: FastifyInstance, sid: string) {
  return (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, cookies: { sid }, ...(payload === undefined ? {} : { payload: payload as object }) });
}

export interface Player {
  name: string;
  id: string;
  sid: string;
  /** Id of a valid saved 60-card deck. */
  deckId: string;
  call: ReturnType<typeof as>;
}

/** Registers a user and gives them a valid saved deck (the engine's `fire` starter deck). */
export async function registerPlayer(app: FastifyInstance, name: string): Promise<Player> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: name, password: PASSWORD },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const sid = sessionCookie(res)!;
  const call = as(app, sid);
  const { starterDecks } = await import('@cardgame/engine');
  const deck = await call('POST', '/api/decks', { name: 'Fire', cards: starterDecks.fire });
  if (deck.statusCode !== 201) throw new Error(`deck failed: ${deck.statusCode} ${deck.body}`);
  return { name, id: res.json().user.id, sid, deckId: deck.json().deck.id, call };
}
