import type { Action, DeckEntry, DeckError, GameEvent, PlayerIndex } from '@cardgame/engine';
import type { PlayerView } from './view.js';

// Shared between the server and the browser client: everything that crosses the network.

export type GameStatus = 'waiting' | 'active' | 'finished' | 'cancelled';

export type OutcomeReason =
  | 'prizes'
  | 'no_creatures'
  | 'deck_out'
  | 'forfeit' // a player gave up
  | 'timeout' // a player did not act in time
  | 'disconnect' // a player did not reconnect in time
  | 'abandoned' // nobody acted / everybody left: no winner
  | 'sudden_death_rematch'; // both took their last prize: a new 1-prize game follows

export interface Outcome {
  winner: PlayerIndex | null;
  reason: OutcomeReason;
}

// ---------- WebSocket: client -> server ----------

export type ClientMessage =
  | { type: 'ping' }
  | { type: 'game.sync' }
  | { type: 'game.forfeit' }
  | { type: 'game.action'; action: Action; requestId?: string };

// ---------- WebSocket: server -> client ----------

export type ServerMessage =
  /** First message on every connection. `game` is your current waiting/active game, if any. */
  | {
      type: 'hello';
      user: { id: string; username: string };
      game: { id: string; status: GameStatus } | null;
    }
  | { type: 'pong' }
  /** Your `game.action` was accepted (its effects arrive as `game.update`). */
  | { type: 'ack'; requestId?: string }
  | { type: 'error'; code: string; message: string; requestId?: string }
  /** Your game began: an opponent joined, or a sudden-death rematch started. */
  | {
      type: 'game.started';
      gameId: string;
      seat: PlayerIndex;
      opponent: string;
      rematchOf: string | null;
    }
  /** Full snapshot: sent on connect, reconnect and `game.sync`. */
  | { type: 'game.state'; gameId: string; seq: number; deadline: number | null; view: PlayerView }
  /** After every accepted action: what happened (for animation) plus the new view. */
  | {
      type: 'game.update';
      gameId: string;
      seq: number;
      events: GameEvent[];
      deadline: number | null;
      view: PlayerView;
    }
  /** The game ended (for any reason). `rematchGameId` is set for sudden death. */
  | { type: 'game.over'; gameId: string; outcome: Outcome; rematchGameId: string | null }
  /** Your waiting game was cancelled because nobody joined in time. */
  | { type: 'game.cancelled'; gameId: string; reason: 'expired' };

// ---------- REST response shapes (dates arrive as ISO strings) ----------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface UserDto {
  id: string;
  username: string;
}

export interface DeckSummaryDto {
  id: string;
  name: string;
  cardCount: number;
  valid: boolean;
  updatedAt: string;
}

export interface DeckDetailDto {
  id: string;
  name: string;
  cards: DeckEntry[];
  cardCount: number;
  valid: boolean;
  errors: DeckError[];
  createdAt: string;
  updatedAt: string;
}

export interface OpenGameDto {
  id: string;
  creator: { username: string };
  createdAt: string;
  mine: boolean;
}

export interface GameSummaryDto {
  id: string;
  status: GameStatus;
  seat: PlayerIndex | null;
  players: Array<{ seat: PlayerIndex; username: string }>;
  createdAt: string;
  startedAt: string | null;
  rematchOf: string | null;
}
