import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { uuidSchema } from '../schemas.js';

const deckBody = z.object({ deckId: z.string().uuid() });

const notFound = () => new AppError(404, 'GAME_NOT_FOUND', 'Game not found');

/** Lobby endpoints: list, create, join and cancel games. Live play happens over the WebSocket. */
export const gameRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: app.requireUser };

  app.get('/api/games', guard, async (req) => {
    const user = req.user!;
    const [open, current] = await Promise.all([app.games.listOpen(), app.games.current(user)]);
    return {
      open: open.map((g) => ({
        id: g.id,
        creator: { username: g.creatorUsername },
        createdAt: g.createdAt,
        mine: g.creatorId === user.id,
      })),
      current,
    };
  });

  app.post('/api/games', guard, async (req, reply) => {
    const { deckId } = deckBody.parse(req.body);
    const game = await app.games.createGame(req.user!, deckId);
    return reply.code(201).send({ game });
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', guard, async (req) => {
    if (!uuidSchema.safeParse(req.params.id).success) throw notFound();
    return { game: await app.games.getGame(req.user!, req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/join', guard, async (req) => {
    if (!uuidSchema.safeParse(req.params.id).success) throw notFound();
    const { deckId } = deckBody.parse(req.body);
    return { game: await app.games.joinGame(req.user!, req.params.id, deckId) };
  });

  app.delete<{ Params: { id: string } }>('/api/games/:id', guard, async (req, reply) => {
    if (!uuidSchema.safeParse(req.params.id).success) throw notFound();
    await app.games.cancelGame(req.user!, req.params.id);
    return reply.code(204).send();
  });
};
