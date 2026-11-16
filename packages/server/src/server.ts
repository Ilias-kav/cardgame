import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { purgeExpiredSessions } from './auth/sessions.js';

const config = loadConfig();
const app = await buildApp();

const restored = await app.games.recover();
if (restored > 0) app.log.info(`Restored ${restored} running game(s)`);

const sweep = async () => {
  const n = await app.games.sweepWaiting();
  if (n > 0) app.log.info(`Cancelled ${n} expired waiting game(s)`);
};
setInterval(() => void sweep().catch((err) => app.log.error(err)), 60 * 1000).unref();

const purge = async () => {
  const n = await purgeExpiredSessions(app.db);
  if (n > 0) app.log.info(`Removed ${n} expired session(s)`);
};
await purge();
setInterval(() => void purge().catch((err) => app.log.error(err)), 60 * 60 * 1000).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
