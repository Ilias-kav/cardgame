import type { ClientMessage, ServerMessage } from '@cardgame/protocol';

export type SocketStatus = 'connecting' | 'open' | 'closed';

/** The small part of the browser WebSocket API we use (so tests can pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
}

export interface GameSocketOptions {
  url: string;
  onMessage(message: ServerMessage): void;
  onStatus(status: SocketStatus): void;
  /** Called when connecting keeps failing; the app uses it to check whether the session expired. */
  onTrouble?(): void;
  create?: (url: string) => SocketLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;
const TROUBLE_AFTER_FAILURES = 3;

/** Delay before reconnect attempt number `attempt` (0, 1, 2, ...): 0.5 s, 1 s, 2 s ... at most 10 s. */
export function backoffDelay(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt);
}

/** Parses a text frame; returns null for anything that is not a message object with a string `type`. */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const value = JSON.parse(data) as unknown;
    if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
      return value as ServerMessage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** A WebSocket that reconnects by itself (with growing delays) until `stop()` is called. */
export class GameSocket {
  private socket: SocketLike | null = null;
  private timer: unknown = null;
  private attempt = 0;
  private failures = 0;
  private everOpened = false;
  private stopped = true;

  constructor(private readonly opts: GameSocketOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.failures = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) (this.opts.clearTimer ?? clearTimeout as (h: unknown) => void)(this.timer);
    this.timer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.onmessage = null;
      s.close();
    }
    this.opts.onStatus('closed');
  }

  /** Returns false when the connection is not open (nothing was sent). */
  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private connect(): void {
    this.opts.onStatus('connecting');
    const socket = (this.opts.create ?? ((url) => new WebSocket(url) as unknown as SocketLike))(this.opts.url);
    this.socket = socket;
    this.everOpened = false;

    socket.onopen = () => {
      this.everOpened = true;
      this.attempt = 0;
      this.failures = 0;
      this.opts.onStatus('open');
    };
    socket.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (message) this.opts.onMessage(message);
    };
    socket.onerror = () => undefined; // a close event always follows
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.opts.onStatus('closed');
      if (this.stopped) return;
      if (!this.everOpened) {
        this.failures++;
        if (this.failures === TROUBLE_AFTER_FAILURES) this.opts.onTrouble?.();
      }
      const delay = backoffDelay(this.attempt++);
      this.timer = (this.opts.setTimer ?? setTimeout as (fn: () => void, ms: number) => unknown)(() => {
        this.timer = null;
        if (!this.stopped) this.connect();
      }, delay);
    };
  }
}

/** ws:// or wss:// URL of the game socket on the page's own host. */
export function gameSocketUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`;
}
