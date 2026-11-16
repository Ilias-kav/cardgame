import {
  createGame,
  validateDeck,
  type CardCatalog,
  type DeckEntry,
  type GameEvent,
} from '@cardgame/engine';
import { AppError } from '../errors.js';
import type { AuthUser } from '../types.js';
import type { Clock } from './clock.js';
import { asEngineAction, type ClientMessage, type ServerMessage } from './protocol.js';
import { replayGame } from './replay.js';
import { GameRoom, type RoomDeps } from './room.js';
import type { GameStore } from './store.js';
import type { GameRecord, GameSummary, WaitingGame } from './types.js';

export type Sender = (message: ServerMessage) => void;

/** Where decks come from (the database in production, a map in tests). */
export interface DeckSource {
  loadDeck(userId: string, deckId: string): Promise<{ id: string; entries: DeckEntry[] } | null>;
}

export interface ManagerDeps {
  catalog: CardCatalog;
  store: GameStore;
  decks: DeckSource;
  clock: Clock;
  turnTimeoutMs: number;
  disconnectGraceMs: number;
  waitingTtlMs: number;
  randomSeed(): number;
  log(message: string, error?: unknown): void;
}

/**
 * Lobby, matchmaking and live games for the whole server: who is connected, which
 * room each player is in, and the entry points used by the REST routes and the
 * WebSocket handler. Runs in ONE process (rooms live in memory); see docs.
 */
export class GameManager {
  private rooms = new Map<string, GameRoom>();
  private roomOfUser = new Map<string, GameRoom>();
  private connections = new Map<string, Set<Sender>>();
  private readonly roomDeps: RoomDeps;

  constructor(private readonly deps: ManagerDeps) {
    this.roomDeps = {
      catalog: deps.catalog,
      store: deps.store,
      clock: deps.clock,
      turnTimeoutMs: deps.turnTimeoutMs,
      disconnectGraceMs: deps.disconnectGraceMs,
      randomSeed: deps.randomSeed,
      log: deps.log,
      send: (userId, message) => this.sendToUser(userId, message),
      onFinished: (room, rematch) => this.handleFinished(room, rematch),
    };
  }

  // ---------- lobby (REST) ----------

  async createGame(user: AuthUser, deckId: string): Promise<GameSummary> {
    const deck = await this.loadPlayableDeck(user.id, deckId);
    const record = await this.deps.store.createWaiting({
      creatorId: user.id,
      deckId: deck.id,
      deck: deck.entries,
    });
    return this.summary(record, user.id);
  }

  async joinGame(user: AuthUser, gameId: string, deckId: string): Promise<GameSummary> {
    const deck = await this.loadPlayableDeck(user.id, deckId);
    const record = await this.deps.store.join({
      gameId,
      userId: user.id,
      deckId: deck.id,
      deck: deck.entries,
      seed: this.deps.randomSeed(),
    });
    await this.startRoom(record, { announce: true });
    return this.summary(record, user.id);
  }

  async cancelGame(user: AuthUser, gameId: string): Promise<void> {
    await this.deps.store.cancel(gameId, user.id);
  }

  async listOpen(): Promise<WaitingGame[]> {
    await this.sweepWaiting();
    return this.deps.store.listWaiting();
  }

  async current(user: AuthUser): Promise<GameSummary | null> {
    const record = await this.deps.store.findCurrentFor(user.id);
    return record ? this.summary(record, user.id) : null;
  }

  async getGame(user: AuthUser, gameId: string): Promise<GameSummary> {
    const record = await this.deps.store.getGame(gameId);
    if (!record || !record.players.some((p) => p.userId === user.id)) {
      throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    }
    return this.summary(record, user.id);
  }

  // ---------- connections (WebSocket) ----------

  async connect(user: AuthUser, send: Sender): Promise<{ disconnect: () => void }> {
    const senders = this.connections.get(user.id) ?? new Set<Sender>();
    senders.add(send);
    this.connections.set(user.id, senders);

    const current = await this.deps.store.findCurrentFor(user.id);
    send({
      type: 'hello',
      user: { id: user.id, username: user.username },
      game: current ? { id: current.id, status: current.status } : null,
    });

    const room = this.roomOfUser.get(user.id);
    if (room) {
      const seat = room.seatOf(user.id);
      if (seat !== null) {
        room.setConnected(seat, true);
        send(room.stateMessage(seat));
      }
    }
    return { disconnect: () => this.disconnect(user.id, send) };
  }

  async handleMessage(user: AuthUser, send: Sender, message: ClientMessage): Promise<void> {
    if (message.type === 'ping') {
      send({ type: 'pong' });
      return;
    }
    const room = this.roomOfUser.get(user.id);
    const requestId = message.type === 'game.action' ? message.requestId : undefined;
    const seat = room?.seatOf(user.id) ?? null;
    if (!room || seat === null) {
      send({ type: 'error', code: 'NO_ACTIVE_GAME', message: 'You are not in a running game', requestId });
      return;
    }

    switch (message.type) {
      case 'game.sync':
        send(room.stateMessage(seat));
        return;
      case 'game.forfeit':
        await room.forfeit(user.id);
        return;
      case 'game.action': {
        const result = await room.submit(user.id, asEngineAction(message.action));
        if (result.ok) send({ type: 'ack', requestId });
        else send({ type: 'error', code: result.error.code, message: result.error.message, requestId });
        return;
      }
    }
  }

  // ---------- lifecycle ----------

  /** Rebuilds every active game from the database (call once at startup). */
  async recover(): Promise<number> {
    const active = await this.deps.store.loadActive();
    let restored = 0;
    for (const { game, actions } of active) {
      try {
        const replayed = replayGame(this.deps.catalog, game, actions);
        await this.startRoom(game, { replayed, announce: false });
        restored++;
      } catch (error) {
        this.deps.log(`Could not recover game ${game.id}; marking it abandoned`, error);
        await this.deps.store
          .finishGame(game.id, { winner: null, reason: 'abandoned' })
          .catch((e) => this.deps.log('...and that failed too', e));
      }
    }
    return restored;
  }

  /** Cancels waiting games nobody joined in time and tells their creators. */
  async sweepWaiting(): Promise<number> {
    const cutoff = new Date(this.deps.clock.now() - this.deps.waitingTtlMs);
    const expired = await this.deps.store.expireWaiting(cutoff);
    for (const { gameId, creatorId } of expired) {
      this.sendToUser(creatorId, { type: 'game.cancelled', gameId, reason: 'expired' });
    }
    return expired.length;
  }

  shutdown(): void {
    for (const room of this.rooms.values()) room.dispose();
  }

  connectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }

  roomFor(userId: string): GameRoom | undefined {
    return this.roomOfUser.get(userId);
  }

  // ---------- internals ----------

  private async loadPlayableDeck(userId: string, deckId: string) {
    const deck = await this.deps.decks.loadDeck(userId, deckId);
    if (!deck) throw new AppError(404, 'DECK_NOT_FOUND', 'Deck not found');
    const errors = validateDeck(this.deps.catalog, deck.entries);
    if (errors.length > 0) {
      throw new AppError(400, 'DECK_INVALID', 'This deck is not valid for play', errors);
    }
    return deck;
  }

  private summary(record: GameRecord, userId: string): GameSummary {
    return {
      id: record.id,
      status: record.status,
      seat: record.players.find((p) => p.userId === userId)?.seat ?? null,
      players: record.players.map((p) => ({ seat: p.seat, username: p.username })),
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      rematchOf: record.rematchOf,
    };
  }

  private hasConnection(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  private async startRoom(
    record: GameRecord,
    options: { replayed?: { state: GameRoom['state']; seq: number }; announce: boolean },
  ): Promise<GameRoom> {
    const [first, second] = [...record.players].sort((a, b) => a.seat - b.seat);
    if (!first || !second || record.seed === null) throw new Error(`Game ${record.id} is not ready`);

    let state;
    let seq = 0;
    let openingEvents: GameEvent[] = [];
    if (options.replayed) {
      state = options.replayed.state;
      seq = options.replayed.seq;
    } else {
      const created = createGame(this.deps.catalog, first.deck, second.deck, record.seed, {
        prizeCount: record.prizeCount,
      });
      if (!created.ok) {
        await this.deps.store.finishGame(record.id, { winner: null, reason: 'abandoned' });
        throw new AppError(500, 'GAME_CREATE_FAILED', 'The game could not be created');
      }
      state = created.value.state;
      openingEvents = created.value.events;
    }

    const room = new GameRoom(this.roomDeps, record, state, seq, [
      this.hasConnection(first.userId),
      this.hasConnection(second.userId),
    ]);
    this.rooms.set(record.id, room);
    this.roomOfUser.set(first.userId, room);
    this.roomOfUser.set(second.userId, room);
    room.start();
    if (options.announce) room.announce(openingEvents);
    return room;
  }

  private handleFinished(room: GameRoom, rematch: GameRecord | null): void {
    this.rooms.delete(room.id);
    for (const p of room.record.players) {
      if (this.roomOfUser.get(p.userId) === room) this.roomOfUser.delete(p.userId);
    }
    room.dispose();
    if (rematch) {
      this.startRoom(rematch, { announce: true }).catch((e) =>
        this.deps.log(`Could not start the rematch of game ${room.id}`, e),
      );
    }
  }

  private disconnect(userId: string, send: Sender): void {
    const senders = this.connections.get(userId);
    if (!senders) return;
    senders.delete(send);
    if (senders.size > 0) return;
    this.connections.delete(userId);
    const room = this.roomOfUser.get(userId);
    const seat = room?.seatOf(userId) ?? null;
    if (room && seat !== null) room.setConnected(seat, false);
  }

  private sendToUser(userId: string, message: ServerMessage): void {
    for (const send of this.connections.get(userId) ?? []) {
      try {
        send(message);
      } catch (error) {
        this.deps.log(`Could not send ${message.type} to ${userId}`, error);
      }
    }
  }
}
