import type { CardId, StatusEffect } from './cards.js';

export type PlayerIndex = 0 | 1;

/** One physical card in one game. `iid` is unique within the game. */
export interface CardInstance {
  iid: string;
  cardId: CardId;
}

export interface CreatureInPlay {
  /** Evolution stack: index 0 = basic, last = current form (its stats are used). */
  stack: CardInstance[];
  /** Attached power cards. Kept across evolution. */
  attached: CardInstance[];
  /** Damage counters in HP. Kept across evolution. */
  damage: number;
  status: StatusEffect | null;
  /** Poison is independent: it can coexist with asleep/paralyzed/confused. */
  poisoned: boolean;
  /** Turn number on which it entered play (a creature cannot evolve that turn). */
  playedOnTurn: number;
  /** Turn number of its last evolution (0 = never). */
  evolvedOnTurn: number;
}

export interface PlayerState {
  /** Index 0 = top of the deck. */
  deck: CardInstance[];
  hand: CardInstance[];
  prizes: CardInstance[];
  discard: CardInstance[];
  active: CreatureInPlay | null;
  bench: CreatureInPlay[];
  /** Only one power card may be attached per turn. */
  powerAttachedThisTurn: boolean;
}

export type GamePhase = 'setup' | 'playing' | 'finished';

export interface SetupState {
  /** Extra cards each player may still draw because the opponent mulliganed. */
  extraDrawAvailable: [number, number];
  /** True once the player has used or declined the extra draw (or had none). */
  extraDrawResolved: [boolean, boolean];
  /** True once the player has placed their starting creatures. */
  placed: [boolean, boolean];
  /** Number of mulligans each player had to take. */
  mulligans: [number, number];
}

/** Something a player must do before the game can continue. Several can be open at once. */
export type PendingDecision = { player: PlayerIndex; type: 'PROMOTE_ACTIVE' };

/**
 * Where the current turn is:
 * - main:    the current player may act
 * - ending:  the turn is over; waiting for promotions, then the between-turns checkup runs
 * - between: checkup done; the next turn begins as soon as nothing is pending
 */
export type TurnStage = 'main' | 'ending' | 'between';

export type GameResult =
  | { winner: PlayerIndex; reason: 'prizes' | 'no_creatures' | 'deck_out' }
  /** Both took the last prize at once: play a new game with 1 prize each. */
  | { winner: null; reason: 'sudden_death_rematch' };

export interface GameState {
  phase: GamePhase;
  players: [PlayerState, PlayerState];
  /** Winner of the opening coin flip. */
  firstPlayer: PlayerIndex;
  currentPlayer: PlayerIndex;
  /** 0 during setup; 1 = first player's first turn; increments every turn. */
  turn: number;
  /** Prize cards each player started with (6 normally, 1 in sudden death). */
  prizeCount: number;
  rngState: number;
  setup: SetupState | null;
  turnStage: TurnStage;
  pendingDecisions: PendingDecision[];
  result: GameResult | null;
}
