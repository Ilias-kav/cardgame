import {
  Rng,
  chooseAction,
  legalActions,
  starterCatalog,
  starterDecks,
  type DeckEntry,
  type PlayerIndex,
} from '@cardgame/engine';
import { AppError } from '../src/errors.js';
import type { Clock } from '../src/game/clock.js';
import { GameManager, type DeckSource, type ManagerDeps } from '../src/game/manager.js';
import { MemoryGameStore } from '../src/game/memory-store.js';
import type { ServerMessage } from '../src/game/protocol.js';
import { actorsFor, type GameRoom } from '../src/game/room.js';
import type { AuthUser } from '../src/types.js';

/** A clock that only moves when the test says so. Timer callbacks run synchronously. */
export class FakeClock implements Clock {
  private t = 1_000_000;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  pending(): number {
    return this.timers.size;
  }
  /** Moves time forward, firing due timers in order, then lets async work settle. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
      await flush();
    }
    this.t = target;
    await flush();
  }
}

/** Lets every pending promise callback run. */
export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export const alice: AuthUser = { id: 'u-alice', username: 'alice' };
export const bob: AuthUser = { id: 'u-bob', username: 'bob' };
export const carol: AuthUser = { id: 'u-carol', username: 'carol' };

/** Decks held in a map: `${userId}/${deckId}` -> entries. */
export class MapDeckSource implements DeckSource {
  private decks = new Map<string, DeckEntry[]>();
  add(userId: string, deckId: string, entries: DeckEntry[]): void {
    this.decks.set(`${userId}/${deckId}`, entries);
  }
  async loadDeck(userId: string, deckId: string) {
    const entries = this.decks.get(`${userId}/${deckId}`);
    return entries ? { id: deckId, entries } : null;
  }
}

export interface Harness {
  manager: GameManager;
  store: MemoryGameStore;
  clock: FakeClock;
  decks: MapDeckSource;
  logs: string[];
  /** Builds a second manager over the same store (simulates a server restart). */
  restart(): GameManager;
}

export function makeHarness(overrides: Partial<ManagerDeps> = {}): Harness {
  const store = new MemoryGameStore();
  const clock = new FakeClock();
  const decks = new MapDeckSource();
  const logs: string[] = [];
  for (const u of [alice, bob, carol]) {
    store.addUser(u.id, u.username);
    decks.add(u.id, 'fire', starterDecks.fire!);
    decks.add(u.id, 'water', starterDecks.water!);
    decks.add(u.id, 'draft', [{ cardId: 'embercub', count: 3 }]);
  }
  let seed = 1000;
  const deps: ManagerDeps = {
    catalog: starterCatalog,
    store,
    decks,
    clock,
    turnTimeoutMs: 120_000,
    disconnectGraceMs: 60_000,
    waitingTtlMs: 30 * 60_000,
    randomSeed: () => seed++,
    log: (m, e) => logs.push(e ? `${m}: ${String(e)}` : m),
    ...overrides,
  };
  return { manager: new GameManager(deps), store, clock, decks, logs, restart: () => new GameManager(deps) };
}

export interface Client {
  user: AuthUser;
  messages: ServerMessage[];
  send: (m: ServerMessage) => void;
  disconnect: () => void;
  ofType<T extends ServerMessage['type']>(type: T): Array<Extract<ServerMessage, { type: T }>>;
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined;
}

/** Opens a (fake) WebSocket connection for a user and records everything they receive. */
export async function connectClient(manager: GameManager, user: AuthUser): Promise<Client> {
  const messages: ServerMessage[] = [];
  const send = (m: ServerMessage) => void messages.push(m);
  const conn = await manager.connect(user, send);
  const ofType = <T extends ServerMessage['type']>(type: T) =>
    messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return { user, messages, send, disconnect: conn.disconnect, ofType, last: (t) => ofType(t).at(-1) };
}

/** alice creates a game with `fire`, bob joins with `water`. Returns the running room. */
export async function startGame(h: Harness): Promise<GameRoom> {
  const created = await h.manager.createGame(alice, 'fire');
  await h.manager.joinGame(bob, created.id, 'water');
  const room = h.manager.roomFor(alice.id);
  if (!room) throw new Error('room was not created');
  return room;
}

/** One player takes their optional extra draw and places their starting creatures. */
export async function setupSeat(room: GameRoom, seat: PlayerIndex): Promise<void> {
  const userId = room.userOf(seat);
  const draws = legalActions(starterCatalog, room.state, seat).filter((a) => a.type === 'SETUP_DRAW_EXTRA');
  if (draws.length > 0) {
    let biggest = draws[0]!;
    for (const d of draws) {
      if (d.type === 'SETUP_DRAW_EXTRA' && biggest.type === 'SETUP_DRAW_EXTRA' && d.count > biggest.count) biggest = d;
    }
    expectOk(await room.submit(userId, biggest));
  }
  const place = legalActions(starterCatalog, room.state, seat).find((a) => a.type === 'SETUP_PLACE');
  if (!place) throw new Error('no placement available');
  expectOk(await room.submit(userId, place));
}

/** Both players take their optional extra draw and place their starting creatures. */
export async function completeSetup(room: GameRoom): Promise<void> {
  await setupSeat(room, 0);
  await setupSeat(room, 1);
}

export function expectOk(r: { ok: boolean; error?: { code: string; message: string } }): void {
  if (!r.ok) throw new Error(`action rejected: ${r.error?.code} ${r.error?.message}`);
}

/** Plays bots against each other through the room until the game ends. */
export async function playToEnd(room: GameRoom, seed = 7, maxActions = 3000): Promise<number> {
  const rng = new Rng(seed);
  let n = 0;
  while (!room.outcome && n < maxActions) {
    const seat: PlayerIndex | undefined = actorsFor(room.state)[0];
    if (seat === undefined) throw new Error('nobody to act');
    const legal = legalActions(starterCatalog, room.state, seat);
    expectOk(await room.submit(room.userOf(seat), chooseAction(legal, rng, 'aggressive')));
    n++;
  }
  return n;
}

/** The AppError a promise rejects with, or null if it resolves. */
export async function errorOf(promise: Promise<unknown>): Promise<AppError | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}
