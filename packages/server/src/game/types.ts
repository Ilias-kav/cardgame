import type { Action, DeckEntry, PlayerIndex } from '@cardgame/engine';
import type { GameStatus, Outcome, OutcomeReason } from '@cardgame/protocol';

export type { GameStatus, Outcome, OutcomeReason };

export interface PlayerRecord {
  userId: string;
  username: string;
  seat: PlayerIndex;
  /** The deck as it was when the game was created or joined. */
  deck: DeckEntry[];
}

export interface GameRecord {
  id: string;
  status: GameStatus;
  creatorId: string;
  seed: number | null;
  prizeCount: number;
  rematchOf: string | null;
  createdAt: Date;
  startedAt: Date | null;
  players: PlayerRecord[];
}

export interface LoggedAction {
  seq: number;
  seat: PlayerIndex;
  action: Action;
}

export interface WaitingGame {
  id: string;
  creatorId: string;
  creatorUsername: string;
  createdAt: Date;
}

/** What the REST API and lobby show about a game. */
export interface GameSummary {
  id: string;
  status: GameStatus;
  /** Your seat, when you take part. */
  seat: PlayerIndex | null;
  players: Array<{ seat: PlayerIndex; username: string }>;
  createdAt: Date;
  startedAt: Date | null;
  rematchOf: string | null;
}
