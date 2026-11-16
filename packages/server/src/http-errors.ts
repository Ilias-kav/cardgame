import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, errorBody } from './errors.js';

/** Makes every failure use the same `{ error: { code, message } }` shape. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send(errorBody('NOT_FOUND', 'No such route'));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(errorBody(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'Invalid request', details));
    }
    // Errors raised by Fastify itself (malformed JSON, wrong content type, ...).
    const status = (err as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send(errorBody('BAD_REQUEST', (err as Error).message));
    }
    req.log.error(err);
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Something went wrong'));
  });
}
