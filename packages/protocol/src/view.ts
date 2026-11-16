import type {
  CardInstance,
  CreatureInPlay,
  GamePhase,
  GameState,
  PendingDecision,
  PlayerIndex,
  TurnStage,
} from '@cardgame/engine';
import type { Outcome } from './messages.js';

/** A player's own side: hand and discard are visible, deck and prizes are only counts. */
export interface OwnSide {
  hand: CardInstance[];
  deckCount: number;
  prizeCount: number;
  discard: CardInstance[];
  active: CreatureInPlay | null;
  bench: CreatureInPlay[];
  powerAttachedThisTurn: boolean;
}

/** The opponent's side: only what a player at the table could see. */
export interface OpponentSide {
  handCount: number;
  deckCount: number;
  prizeCount: number;
  discard: CardInstance[];
  active: CreatureInPlay | null;
  bench: CreatureInPlay[];
}

export interface SetupSide {
  extraDrawAvailable: number;
  extraDrawResolved: boolean;
  placed: boolean;
  mulligans: number;
}

/**
 * Everything one player is allowed to know about a game. This is the ONLY
 * game data ever sent to a client: the raw GameState (opponent hand, deck
 * order, prize cards, random generator state) never leaves the server.
 */
export interface PlayerView {
  seat: PlayerIndex;
  phase: GamePhase;
  turn: number;
  currentPlayer: PlayerIndex;
  turnStage: TurnStage;
  firstPlayer: PlayerIndex;
  /** Prize cards each player started with. */
  startingPrizes: number;
  pendingDecisions: PendingDecision[];
  setup: { you: SetupSide; opponent: SetupSide } | null;
  you: OwnSide;
  opponent: OpponentSide;
  outcome: Outcome | null;
}

export function viewFor(state: GameState, seat: PlayerIndex, outcome: Outcome | null): PlayerView {
  const opp: PlayerIndex = seat === 0 ? 1 : 0;
  const me = state.players[seat];
  const them = state.players[opp];
  const inSetup = state.phase === 'setup' && state.setup !== null;

  // While setup runs, the opponent's starting creatures stay secret until both have placed
  // them. Their hand size would reveal the bench size, so it is reported as if nothing
  // had been placed yet.
  const hideTheirBoard = inSetup;
  const placedByThem = them.bench.length + (them.active ? 1 : 0);
  const theirHandCount = hideTheirBoard ? them.hand.length + placedByThem : them.hand.length;

  const setupSide = (p: PlayerIndex): SetupSide => {
    const s = state.setup!;
    return {
      extraDrawAvailable: s.extraDrawAvailable[p],
      extraDrawResolved: s.extraDrawResolved[p],
      placed: s.placed[p],
      mulligans: s.mulligans[p],
    };
  };

  return {
    seat,
    phase: state.phase,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    turnStage: state.turnStage,
    firstPlayer: state.firstPlayer,
    startingPrizes: state.prizeCount,
    pendingDecisions: state.pendingDecisions,
    setup: inSetup ? { you: setupSide(seat), opponent: setupSide(opp) } : null,
    you: {
      hand: me.hand,
      deckCount: me.deck.length,
      prizeCount: me.prizes.length,
      discard: me.discard,
      active: me.active,
      bench: me.bench,
      powerAttachedThisTurn: me.powerAttachedThisTurn,
    },
    opponent: {
      handCount: theirHandCount,
      deckCount: them.deck.length,
      prizeCount: them.prizes.length,
      discard: them.discard,
      active: hideTheirBoard ? null : them.active,
      bench: hideTheirBoard ? [] : them.bench,
    },
    outcome,
  };
}
