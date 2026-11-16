import type { CreatureRef } from './actions.js';
import { getCard, type CardCatalog, type CreatureCard } from './cards.js';
import type { CardInstance, CreatureInPlay, GameState, PlayerIndex } from './state.js';

/** GameState is plain JSON data, so a JSON round-trip is a safe deep copy. */
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function otherPlayer(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

export function newCreature(card: CardInstance, turn: number): CreatureInPlay {
  return {
    stack: [card],
    attached: [],
    damage: 0,
    status: null,
    poisoned: false,
    playedOnTurn: turn,
    evolvedOnTurn: 0,
  };
}

/** The creature card currently in force (top of the evolution stack). */
export function creatureCard(catalog: CardCatalog, creature: CreatureInPlay): CreatureCard {
  const top = creature.stack[creature.stack.length - 1];
  if (!top) throw new Error('Creature with empty stack');
  const card = getCard(catalog, top.cardId);
  if (card.kind !== 'creature') throw new Error(`Not a creature: ${top.cardId}`);
  return card;
}

/** Looks up a creature by reference; tolerant of malformed input (returns null). */
export function resolveRef(
  state: GameState,
  player: PlayerIndex,
  ref: CreatureRef,
): CreatureInPlay | null {
  const p = state.players[player];
  if (!ref || typeof ref !== 'object') return null;
  if (ref.zone === 'active') return p.active;
  if (ref.zone === 'bench' && Number.isInteger(ref.index)) return p.bench[ref.index] ?? null;
  return null;
}

export function hasCreatures(state: GameState, player: PlayerIndex): boolean {
  const p = state.players[player];
  return p.active !== null || p.bench.length > 0;
}

/** Moves up to `count` cards from the top of the deck to the hand. Returns how many moved. */
export function drawCards(state: GameState, player: PlayerIndex, count: number): number {
  const p = state.players[player];
  const drawn = p.deck.splice(0, count);
  p.hand.push(...drawn);
  return drawn.length;
}
