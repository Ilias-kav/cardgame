import type { FastifyPluginAsync } from 'fastify';
import { cards } from '../db/schema.js';

export const cardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/cards', { preHandler: app.requireUser }, async () => {
    const rows = await app.db.select({ data: cards.data }).from(cards).orderBy(cards.id);
    return { cards: rows.map((r) => r.data) };
  });
};
