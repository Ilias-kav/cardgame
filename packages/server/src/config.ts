import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** scrypt cost parameter N = 2^SCRYPT_LOG_N. */
  SCRYPT_LOG_N: z.coerce.number().int().min(10).max(20).default(17),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
  /** Time a player has to finish their turn (or setup / promotion) before losing. */
  TURN_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(120),
  /** How long a player may be disconnected from their running game before forfeiting. */
  DISCONNECT_GRACE_SECONDS: z.coerce.number().int().min(1).default(60),
  /** Waiting games nobody joined are cancelled after this long. */
  WAITING_GAME_TTL_MINUTES: z.coerce.number().int().min(1).default(30),
  /** Set to "true" behind a reverse proxy (Caddy, nginx) so client IPs come from X-Forwarded-For. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Folder with the built web client (packages/web/dist). When set, the server serves it. */
  WEB_DIST: z.string().min(1).optional(),
  /** Comma-separated browser origins allowed to open the WebSocket. */
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000'),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  sessionTtlDays: number;
  scryptLogN: number;
  rateLimitMax: number;
  rateLimitWindow: string;
  turnTimeoutMs: number;
  disconnectGraceMs: number;
  waitingGameTtlMs: number;
  allowedOrigins: string[];
  trustProxy: boolean;
  webDist: string | undefined;
}

/** Reads and validates configuration; throws a readable error listing every problem. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    scryptLogN: e.SCRYPT_LOG_N,
    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitWindow: e.RATE_LIMIT_WINDOW,
    turnTimeoutMs: e.TURN_TIMEOUT_SECONDS * 1000,
    disconnectGraceMs: e.DISCONNECT_GRACE_SECONDS * 1000,
    waitingGameTtlMs: e.WAITING_GAME_TTL_MINUTES * 60 * 1000,
    trustProxy: e.TRUST_PROXY === 'true',
    webDist: e.WEB_DIST,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
