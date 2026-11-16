import type { CreatureRef } from './actions.js';
import type { CardId, StatusEffect } from './cards.js';
import type { GameResult, PlayerIndex } from './state.js';

export type CoinPurpose = 'attack_effect' | 'confusion_attack' | 'confusion_retreat' | 'sleep_wake';
export type DamageSource = 'attack' | 'confusion' | 'poison';
export type StatusName = StatusEffect | 'poisoned';

/**
 * Facts about what happened, in order. The UI uses them to animate and to fill
 * the action log. Events never contain hidden information, except where the
 * rules make it public (e.g. a mulligan reveals the hand). `player` is always
 * the player the fact is about (for DAMAGE: the owner of the damaged creature).
 */
export type GameEvent =
  // --- setup ---
  | { type: 'COIN_FLIP'; purpose: 'first_player'; heads: boolean; winner: PlayerIndex }
  | { type: 'MULLIGAN'; player: PlayerIndex; revealedHand: CardId[]; opponentMayDraw: boolean }
  | { type: 'EXTRA_DRAW'; player: PlayerIndex; count: number }
  | { type: 'SETUP_PLACED'; player: PlayerIndex }
  | { type: 'GAME_STARTED'; firstPlayer: PlayerIndex }
  // --- turn flow ---
  | { type: 'TURN_STARTED'; player: PlayerIndex; turn: number }
  | { type: 'TURN_ENDED'; player: PlayerIndex }
  | { type: 'CARD_DRAWN'; player: PlayerIndex; count: number }
  | { type: 'CREATURE_PLAYED'; player: PlayerIndex; cardId: CardId; benchIndex: number }
  | { type: 'POWER_ATTACHED'; player: PlayerIndex; cardId: CardId; target: CreatureRef }
  | { type: 'EVOLVED'; player: PlayerIndex; cardId: CardId; target: CreatureRef }
  | { type: 'ITEM_PLAYED'; player: PlayerIndex; cardId: CardId }
  | { type: 'ABILITY_USED'; player: PlayerIndex; target: CreatureRef }
  | { type: 'RETREATED'; player: PlayerIndex; benchIndex: number }
  | { type: 'RETREAT_FAILED'; player: PlayerIndex }
  | { type: 'PROMOTED'; player: PlayerIndex; benchIndex: number }
  // --- combat ---
  | { type: 'COIN_FLIP'; purpose: CoinPurpose; heads: boolean; player: PlayerIndex }
  | { type: 'ATTACK_DECLARED'; player: PlayerIndex; attack: string }
  | { type: 'DAMAGE'; player: PlayerIndex; target: CreatureRef; amount: number; source: DamageSource }
  | { type: 'CREATURE_HEALED'; player: PlayerIndex; target: CreatureRef; amount: number }
  | { type: 'STATUS_APPLIED'; player: PlayerIndex; status: StatusName }
  | { type: 'STATUS_REMOVED'; player: PlayerIndex; status: StatusName }
  | { type: 'CREATURE_KNOCKED_OUT'; player: PlayerIndex; cardIds: CardId[] }
  | { type: 'PRIZE_TAKEN'; player: PlayerIndex }
  // --- end ---
  | { type: 'GAME_OVER'; result: GameResult };
