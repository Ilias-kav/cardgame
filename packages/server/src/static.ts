import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

/**
 * Serves the built web client (packages/web/dist) so one process serves both the app and the API.
 * The client uses hash routing, so only "/" needs index.html. Hashed files under /assets are cached
 * for a year; everything else is revalidated on each visit so a new release shows up immediately.
 */
export const staticRoutes: FastifyPluginAsync<{ dir: string }> = async (app, { dir }) => {
  await app.register(fastifyStatic, {
    root: dir,
    setHeaders: (res, filePath) => {
      const immutable = /[\\/]assets[\\/]/.test(filePath);
      res.setHeader('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
};
