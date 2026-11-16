import type { Action, DeckEntry, PlayerIndex } from '@cardgame/engine';
import { AppError } from '../errors.js';
import type { GameStore, RematchRequest } from './store.js';
import type { GameRecord, GameStatus, LoggedAction, Outcome, WaitingGame } from './types.js';

interface Row {
  record: GameRecord;
  status: GameStatus;
  outcome: Outcome | null;
  actions: LoggedAction[];
  inGame: Set<string>;
}

/** In-memory GameStore for tests and local experiments. Mirrors the SQL rules. */
export class MemoryGameStore implements GameStore {
  private games = new Map<string, Row>();
  private nextId = 1;
  /** user id -> username; filled by `addUser` (stands in for the users table). */
  private usernames = new Map<string, string>();
  /** Test hook: make the next appendAction fail. */
  failNextAppend = false;

  addUser(id: string, username: string): void {
    this.usernames.set(id, username);
  }

  private nameOf(userId: string): string {
    return this.usernames.get(userId) ?? userId;
  }

  private busy(userId: string): boolean {
    for (const row of this.games.values()) if (row.inGame.has(userId)) return true;
    return false;
  }

  private snapshot(row: Row): GameRecord {
    return { ...row.record, status: row.status, players: row.record.players.map((p) => ({ ...p })) };
  }

  async createWaiting(input: { creatorId: string; deckId: string | null; deck: DeckEntry[] }) {
    if (this.busy(input.creatorId)) throw new AppError(409, 'ALREADY_IN_GAME', 'You are already in a game');
    const id = `g${this.nextId++}`;
    const record: GameRecord = {
      id,
      status: 'waiting',
      creatorId: input.creatorId,
      seed: null,
      prizeCount: 6,
      rematchOf: null,
      createdAt: new Date(),
      startedAt: null,
      players: [{ userId: input.creatorId, username: this.nameOf(input.creatorId), seat: 0, deck: input.deck }],
    };
    this.games.set(id, {
      record,
      status: 'waiting',
      outcome: null,
      actions: [],
      inGame: new Set([input.creatorId]),
    });
    return this.snapshot(this.games.get(id)!);
  }

  async join(input: { gameId: string; userId: string; deckId: string | null; deck: DeckEntry[]; seed: number }) {
    const row = this.games.get(input.gameId);
    if (!row) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (row.status !== 'waiting') throw new AppError(409, 'GAME_NOT_OPEN', 'This game is no longer open');
    if (row.record.creatorId === input.userId) {
      throw new AppError(409, 'CANNOT_JOIN_OWN_GAME', 'You cannot join your own game');
    }
    if (this.busy(input.userId)) throw new AppError(409, 'ALREADY_IN_GAME', 'You are already in a game');
    row.record.players.push({
      userId: input.userId,
      username: this.nameOf(input.userId),
      seat: 1,
      deck: input.deck,
    });
    row.inGame.add(input.userId);
    row.status = 'active';
    row.record.seed = input.seed;
    row.record.startedAt = new Date();
    return this.snapshot(row);
  }

  async cancel(gameId: string, userId: string) {
    const row = this.games.get(gameId);
    if (!row || row.record.creatorId !== userId) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
    if (row.status !== 'waiting') throw new AppError(409, 'GAME_NOT_OPEN', 'This game is no longer open');
    row.status = 'cancelled';
    row.inGame.clear();
  }

  async listWaiting(): Promise<WaitingGame[]> {
    return [...this.games.values()]
      .filter((r) => r.status === 'waiting')
      .map((r) => ({
        id: r.record.id,
        creatorId: r.record.creatorId,
        creatorUsername: this.nameOf(r.record.creatorId),
        createdAt: r.record.createdAt,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findCurrentFor(userId: string) {
    for (const row of this.games.values()) if (row.inGame.has(userId)) return this.snapshot(row);
    return null;
  }

  async getGame(gameId: string) {
    const row = this.games.get(gameId);
    return row ? this.snapshot(row) : null;
  }

  async appendAction(gameId: string, seq: number, seat: PlayerIndex, action: Action) {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error('simulated database failure');
    }
    const row = this.games.get(gameId);
    if (!row) throw new Error(`unknown game ${gameId}`);
    if (row.actions.some((a) => a.seq === seq)) throw new Error(`duplicate seq ${seq}`);
    row.actions.push({ seq, seat, action: JSON.parse(JSON.stringify(action)) as Action });
  }

  async finishGame(gameId: string, outcome: Outcome, rematch?: RematchRequest) {
    const row = this.games.get(gameId);
    if (!row) throw new Error(`unknown game ${gameId}`);
    row.status = 'finished';
    row.outcome = outcome;
    const players = row.record.players;
    row.inGame.clear();
    if (!rematch) return null;

    const id = `g${this.nextId++}`;
    const record: GameRecord = {
      id,
      status: 'active',
      creatorId: row.record.creatorId,
      seed: rematch.seed,
      prizeCount: rematch.prizeCount,
      rematchOf: gameId,
      createdAt: new Date(),
      startedAt: new Date(),
      players: players.map((p) => ({ ...p })),
    };
    this.games.set(id, {
      record,
      status: 'active',
      outcome: null,
      actions: [],
      inGame: new Set(players.map((p) => p.userId)),
    });
    return this.snapshot(this.games.get(id)!);
  }

  async loadActive() {
    return [...this.games.values()]
      .filter((r) => r.status === 'active')
      .map((r) => ({
        game: this.snapshot(r),
        actions: [...r.actions].sort((a, b) => a.seq - b.seq),
      }));
  }

  async expireWaiting(before: Date) {
    const expired: Array<{ gameId: string; creatorId: string }> = [];
    for (const row of this.games.values()) {
      if (row.status === 'waiting' && row.record.createdAt < before) {
        row.status = 'cancelled';
        row.inGame.clear();
        expired.push({ gameId: row.record.id, creatorId: row.record.creatorId });
      }
    }
    return expired;
  }

  // ----- test helpers -----
  actionsOf(gameId: string): LoggedAction[] {
    return [...(this.games.get(gameId)?.actions ?? [])].sort((a, b) => a.seq - b.seq);
  }
  outcomeOf(gameId: string): Outcome | null {
    return this.games.get(gameId)?.outcome ?? null;
  }
  statusOf(gameId: string): GameStatus | undefined {
    return this.games.get(gameId)?.status;
  }
  /** Pretends a waiting game was created long ago. */
  backdate(gameId: string, createdAt: Date): void {
    const row = this.games.get(gameId);
    if (row) row.record.createdAt = createdAt;
  }
}
