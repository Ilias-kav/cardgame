import type { ServerMessage } from '@cardgame/protocol';
import { describe, expect, it } from 'vitest';
import { GameSocket, backoffDelay, gameSocketUrl, parseServerMessage, type SocketLike, type SocketStatus } from '../src/socket.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  // test controls
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const statuses: SocketStatus[] = [];
  const messages: ServerMessage[] = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  let trouble = 0;
  const socket = new GameSocket({
    url: 'ws://x/ws',
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    onTrouble: () => trouble++,
    create: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cancelled: boolean }).cancelled = true;
    },
  });
  const fire = () => {
    const t = timers.find((x) => !x.cancelled)!;
    t.cancelled = true;
    t.fn();
  };
  return { socket, sockets, statuses, messages, timers, fire, trouble: () => trouble };
}

describe('backoffDelay', () => {
  it('grows and is capped at 10 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(backoffDelay)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  });
});

describe('parseServerMessage', () => {
  it('accepts JSON objects with a type and nothing else', () => {
    expect(parseServerMessage('{"type":"pong"}')).toEqual({ type: 'pong' });
    for (const bad of ['not json', '[]', '{}', '{"type":5}', 'null', 42, undefined, new ArrayBuffer(2)]) {
      expect(parseServerMessage(bad)).toBeNull();
    }
  });
});

describe('gameSocketUrl', () => {
  it('uses wss on https pages and ws otherwise', () => {
    expect(gameSocketUrl({ protocol: 'https:', host: 'a.example' })).toBe('wss://a.example/ws');
    expect(gameSocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
  });
});

describe('GameSocket', () => {
  it('connects, reports status and delivers messages', () => {
    const h = harness();
    h.socket.start();
    expect(h.statuses).toEqual(['connecting']);
    h.sockets[0]!.open();
    expect(h.statuses.at(-1)).toBe('open');
    h.sockets[0]!.receive('{"type":"pong"}');
    h.sockets[0]!.receive('garbage');
    expect(h.messages).toEqual([{ type: 'pong' }]);
  });

  it('sends JSON only while open', () => {
    const h = harness();
    h.socket.start();
    expect(h.socket.send({ type: 'ping' })).toBe(false);
    h.sockets[0]!.open();
    expect(h.socket.send({ type: 'game.forfeit' })).toBe(true);
    expect(h.sockets[0]!.sent).toEqual(['{"type":"game.forfeit"}']);
  });

  it('reconnects after a drop, with growing delays that reset once connected', () => {
    const h = harness();
    h.socket.start();
    h.sockets[0]!.open();
    h.sockets[0]!.drop();
    expect(h.timers.at(-1)!.ms).toBe(500);
    h.fire();
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.drop(); // failed to connect
    expect(h.timers.at(-1)!.ms).toBe(1000);
    h.fire();
    h.sockets[2]!.open(); // success resets the backoff
    h.sockets[2]!.drop();
    expect(h.timers.at(-1)!.ms).toBe(500);
  });

  it('reports trouble once when connecting keeps failing (e.g. the session expired)', () => {
    const h = harness();
    h.socket.start();
    for (let i = 0; i < 5; i++) {
      h.sockets.at(-1)!.drop();
      h.fire();
    }
    expect(h.trouble()).toBe(1);
  });

  it('stop() closes the connection and cancels any reconnect', () => {
    const h = harness();
    h.socket.start();
    h.sockets[0]!.open();
    h.socket.stop();
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.statuses.at(-1)).toBe('closed');
    h.sockets[0]!.drop(); // late close event must not schedule anything
    expect(h.timers.filter((t) => !t.cancelled)).toHaveLength(0);
    expect(h.sockets).toHaveLength(1);
  });

  it('can be started again after stop()', () => {
    const h = harness();
    h.socket.start();
    h.socket.stop();
    h.socket.start();
    expect(h.sockets).toHaveLength(2);
  });
});
