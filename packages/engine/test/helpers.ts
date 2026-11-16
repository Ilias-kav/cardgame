import {
  Rng,
  applyAction,
  type Action,
  type CardInstance,
  type CreatureInPlay,
  type GameEvent,
  type GameState,
  type PlayerIndex,
  type PlayerState,
  type StatusEffect,
} from '../src/index.js';
import { catalog } from './fixtures.js';

let counter = 0;
export const inst = (cardId: string): CardInstance => ({ iid: `t${counter++}`, cardId });

export interface CreatureOpts {
  /** Evolution stack, basic first. Defaults to just the card id given. */
  stack?: string[];
  attached?: string[];
  damage?: number;
  status?: StatusEffect | null;
  poisoned?: boolean;
  playedOnTurn?: number;
  evolvedOnTurn?: number;
}

export function creature(cardId: string, o: CreatureOpts = {}): CreatureInPlay {
  return {
    stack: (o.stack ?? [cardId]).map(inst),
    attached: (o.attached ?? []).map(inst),
    damage: o.damage ?? 0,
    status: o.status ?? null,
    poisoned: o.poisoned ?? false,
    playedOnTurn: o.playedOnTurn ?? 0,
    evolvedOnTurn: o.evolvedOnTurn ?? 0,
  };
}

export interface PlayerSpec {
  active?: CreatureInPlay | null;
  bench?: CreatureInPlay[];
  hand?: string[];
  /** Number of filler cards in the deck (default 10). */
  deck?: number;
  /** Number of prize cards left (default 6). */
  prizes?: number;
  discard?: string[];
}

function player(spec: PlayerSpec = {}): PlayerState {
  return {
    deck: Array.from({ length: spec.deck ?? 10 }, () => inst('power-fire')),
    hand: (spec.hand ?? []).map(inst),
    prizes: Array.from({ length: spec.prizes ?? 6 }, () => inst('power-fire')),
    discard: (spec.discard ?? []).map(inst),
    active: spec.active === undefined ? creature('bruiser') : spec.active,
    bench: spec.bench ?? [],
    powerAttachedThisTurn: false,
  };
}

/** Builds a game in progress, in the main phase of `turn` (default turn 5, player 0). */
export function makeState(
  o: {
    turn?: number;
    current?: PlayerIndex;
    p0?: PlayerSpec;
    p1?: PlayerSpec;
    /** Forces the upcoming coin flips; see `rngFor`. */
    flips?: boolean[];
  } = {},
): GameState {
  return {
    phase: 'playing',
    players: [player(o.p0), player(o.p1)],
    firstPlayer: 0,
    currentPlayer: o.current ?? 0,
    turn: o.turn ?? 5,
    prizeCount: 6,
    rngState: o.flips ? rngFor(o.flips) : 1,
    setup: null,
    turnStage: 'main',
    pendingDecisions: [],
    result: null,
  };
}

/** Finds an rng state whose next coin flips are exactly `flips` (true = heads). */
export function rngFor(flips: boolean[]): number {
  for (let seed = 1; seed < 200_000; seed++) {
    const rng = new Rng(seed);
    if (flips.every((f) => rng.coinFlip() === f)) return seed;
  }
  throw new Error('no seed found');
}

/** Applies an action and returns the result, throwing if the engine rejected it. */
export function act(
  state: GameState,
  p: PlayerIndex,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  const r = applyAction(catalog, state, p, action);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} - ${r.error.message}`);
  return r.value;
}

/** Applies an action that must be rejected; returns the error code. */
export function rejected(state: GameState, p: PlayerIndex, action: Action): string {
  const r = applyAction(catalog, state, p, action);
  if (r.ok) throw new Error(`${action.type} was accepted but should have been rejected`);
  return r.error.code;
}

export const iidOf = (cards: CardInstance[], cardId: string): string => {
  const c = cards.find((x) => x.cardId === cardId);
  if (!c) throw new Error(`no ${cardId}`);
  return c.iid;
};

export const eventsOfType = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
