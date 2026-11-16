import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async (_req, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { ok: true };
    } catch (err) {
      app.log.error(err);
      return reply.code(503).send({ ok: false });
    }
  });
};
