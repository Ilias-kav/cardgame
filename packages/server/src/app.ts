import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { starterCatalog, type CardCatalog } from '@cardgame/engine';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { makeRequireUser } from './auth/guard.js';
import { loadConfig, type Config } from './config.js';
import { createDb } from './db/client.js';
import { AppError } from './errors.js';
import { registerErrorHandling } from './http-errors.js';
import { authRoutes } from './routes/auth.js';
import { cardRoutes } from './routes/cards.js';
import { deckRoutes } from './routes/decks.js';
import { DbDeckSource, DrizzleGameStore } from './game/db-store.js';
import { realClock, type Clock } from './game/clock.js';
import { GameManager } from './game/manager.js';
import { gameRoutes } from './routes/games.js';
import { healthRoutes } from './routes/health.js';
import { staticRoutes } from './static.js';
import { wsRoutes } from './ws.js';
import './types.js';

export interface BuildAppOptions {
  /** Overrides on top of the environment configuration (used by tests). */
  config?: Partial<Config>;
  /** Card catalog used for deck validation. Defaults to the engine's starter set. */
  catalog?: CardCatalog;
  logger?: boolean;
  /** Time source for game timers (tests pass a fake). */
  clock?: Clock;
}

/** Builds the server without starting it, so tests can call it with `app.inject()`. */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config: Config = { ...loadConfig(), ...options.config };
  const catalog = options.catalog ?? starterCatalog;

  const { db, client } = createDb(config.databaseUrl);
  const app = Fastify({
    logger: options.logger ?? config.nodeEnv !== 'test',
    // Behind a reverse proxy the real client address is in X-Forwarded-For (needed for rate limiting).
    trustProxy: config.trustProxy,
  });
  app.addHook('onClose', async () => {
    await client.end();
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false, // only routes that opt in (login/register) are limited
    errorResponseBuilder: (_req, context) =>
      new AppError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${context.after}.`),
  });

  const games = new GameManager({
    catalog,
    store: new DrizzleGameStore(db),
    decks: new DbDeckSource(db),
    clock: options.clock ?? realClock,
    turnTimeoutMs: config.turnTimeoutMs,
    disconnectGraceMs: config.disconnectGraceMs,
    waitingTtlMs: config.waitingGameTtlMs,
    randomSeed: () => randomBytes(4).readUInt32BE(0),
    log: (message, error) => (error ? app.log.error({ err: error }, message) : app.log.warn(message)),
  });
  app.addHook('onClose', async () => {
    games.shutdown();
  });

  app.decorateRequest('user', null);
  app.decorate('db', db);
  app.decorate('games', games);
  app.decorate('requireUser', makeRequireUser(db));
  registerErrorHandling(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { config });
  await app.register(cardRoutes);
  await app.register(deckRoutes, { catalog });
  await app.register(gameRoutes);
  await app.register(wsRoutes, { config });
  if (config.webDist) {
    if (existsSync(config.webDist)) await app.register(staticRoutes, { dir: config.webDist });
    else app.log.warn(`WEB_DIST ${config.webDist} does not exist; the web client is not served`);
  }

  return app;
}
