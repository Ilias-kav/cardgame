import type { Action, DeckEntry, PlayerIndex } from '@cardgame/engine';
import type { GameRecord, LoggedAction, Outcome, WaitingGame } from './types.js';

export interface RematchRequest {
  seed: number;
  prizeCount: number;
}

/**
 * Everything the game server needs to persist. Two implementations exist:
 * `DrizzleGameStore` (PostgreSQL) and `MemoryGameStore` (tests). Both must enforce
 * the same rules, in particular "a player is in at most one game at a time".
 *
 * Methods throw `AppError` for rule violations:
 *   ALREADY_IN_GAME (409), GAME_NOT_FOUND (404), GAME_NOT_OPEN (409), CANNOT_JOIN_OWN_GAME (409)
 */
export interface GameStore {
  /** New waiting game with the creator in seat 0. */
  createWaiting(input: { creatorId: string; deckId: string | null; deck: DeckEntry[] }): Promise<GameRecord>;

  /** Puts the joiner in seat 1 and makes the game active, atomically. */
  join(input: {
    gameId: string;
    userId: string;
    deckId: string | null;
    deck: DeckEntry[];
    seed: number;
  }): Promise<GameRecord>;

  /** Cancels a waiting game; only its creator may. */
  cancel(gameId: string, userId: string): Promise<void>;

  /** Waiting games, oldest first. */
  listWaiting(): Promise<WaitingGame[]>;

  /** The user's waiting or active game, if any. */
  findCurrentFor(userId: string): Promise<GameRecord | null>;

  getGame(gameId: string): Promise<GameRecord | null>;

  /** Appends one accepted action to the game's log (seq starts at 1). */
  appendAction(gameId: string, seq: number, seat: PlayerIndex, action: Action): Promise<void>;

  /**
   * Marks the game finished and frees its players. With `rematch`, atomically starts a
   * new active game for the same players and decks (sudden death) and returns it.
   */
  finishGame(gameId: string, outcome: Outcome, rematch?: RematchRequest): Promise<GameRecord | null>;

  /** Active games with their full action logs, for recovery after a restart. */
  loadActive(): Promise<Array<{ game: GameRecord; actions: LoggedAction[] }>>;

  /** Cancels waiting games created before `before`; returns what was cancelled. */
  expireWaiting(before: Date): Promise<Array<{ gameId: string; creatorId: string }>>;
}
