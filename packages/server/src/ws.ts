import websocket from '@fastify/websocket';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { errorBody } from './errors.js';
import { TokenBucket } from './game/limiter.js';
import { clientMessageSchema, type ServerMessage } from './game/protocol.js';

const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_CONNECTIONS_PER_USER = 5;
const HEARTBEAT_MS = 30_000;

interface Options {
  config: Config;
}

/**
 * GET /ws: the live-game WebSocket. The browser's session cookie authenticates the
 * handshake (a normal HTTP request, so a missing/expired session gets a plain 401),
 * and the Origin header is checked so other websites cannot open a socket on a
 * logged-in user's behalf.
 */
export const wsRoutes: FastifyPluginAsync<Options> = async (app, { config }) => {
  await app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });

  async function checkOrigin(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const origin = req.headers.origin;
    // Browsers always send Origin on WebSocket handshakes; other clients may omit it.
    if (origin && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send(errorBody('FORBIDDEN_ORIGIN', 'Origin not allowed'));
    }
    return undefined;
  }

  app.get('/ws', { websocket: true, preValidation: [checkOrigin, app.requireUser] }, (socket, req) => {
    const user = req.user!;
    const send = (message: ServerMessage): void => {
      if (socket.readyState === 1) socket.send(JSON.stringify(message));
    };

    if (app.games.connectionCount(user.id) >= MAX_CONNECTIONS_PER_USER) {
      send({ type: 'error', code: 'TOO_MANY_CONNECTIONS', message: 'Too many open connections' });
      socket.close(1008, 'too many connections');
      return;
    }

    // Listeners are attached right away; messages that arrive while the connection is still
    // being registered wait for it.
    const ready = app.games.connect(user, send);
    const bucket = new TokenBucket(40, 20); // bursts of 40, then 20 messages per second
    let alive = true;

    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (!bucket.take()) {
        send({ type: 'error', code: 'RATE_LIMITED', message: 'You are sending messages too fast' });
        socket.close(1008, 'rate limit');
        return;
      }
      let json: unknown;
      try {
        if (isBinary) throw new Error('binary');
        json = JSON.parse(raw.toString());
      } catch {
        send({ type: 'error', code: 'BAD_MESSAGE', message: 'Messages must be JSON text' });
        return;
      }
      const parsed = clientMessageSchema.safeParse(json);
      if (!parsed.success) {
        send({ type: 'error', code: 'BAD_MESSAGE', message: 'Unknown or malformed message' });
        return;
      }
      void ready
        .then(() => app.games.handleMessage(user, send, parsed.data))
        .catch((error) => {
          app.log.error(error);
          send({ type: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong' });
        });
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      void ready.then((connection) => connection.disconnect()).catch(() => undefined);
    });
    socket.on('error', (error: Error) => app.log.warn(error));
  });
};
