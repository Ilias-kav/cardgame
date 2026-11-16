import type { CreatureRef } from './actions.js';
import type { CardCatalog } from './cards.js';
import type { GameEvent } from './events.js';
import type { EngineError } from './result.js';
import type { Rng } from './rng.js';
import type { GameState, PlayerIndex } from './state.js';
import { drawCards, resolveRef } from './util.js';

/**
 * Effects (item cards, abilities, custom attack effects) are code, referenced
 * from card data by handler name. A handler may freely mutate `state`: the
 * engine works on a copy and throws it away if the handler returns an error.
 */
export interface EffectContext {
  catalog: CardCatalog;
  state: GameState;
  rng: Rng;
  events: GameEvent[];
  /** The player who plays the item / uses the ability / attacks. */
  player: PlayerIndex;
  /** Trusted: parameters written on the card. */
  params: Readonly<Record<string, unknown>>;
  /** Untrusted: choices supplied by the player (targets, ...). Always validate. */
  input: Readonly<Record<string, unknown>>;
  /** The creature using the ability or attack, when there is one. */
  source?: CreatureRef;
}

export type EffectHandler = (ctx: EffectContext) => EngineError | undefined;
export type EffectRegistry = Readonly<Record<string, EffectHandler>>;

function parseRef(value: unknown): CreatureRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.zone === 'active') return { zone: 'active' };
  if (v.zone === 'bench' && typeof v.index === 'number' && Number.isInteger(v.index)) {
    return { zone: 'bench', index: v.index };
  }
  return null;
}

/** params: { amount }; input: { target: CreatureRef } (one of your own creatures). */
const heal: EffectHandler = (ctx) => {
  const amount = ctx.params.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { code: 'BAD_EFFECT_PARAMS', message: 'heal needs a positive amount' };
  }
  const ref = parseRef(ctx.input.target);
  const creature = ref ? resolveRef(ctx.state, ctx.player, ref) : null;
  if (!ref || !creature) return { code: 'INVALID_TARGET', message: 'Choose one of your creatures' };
  const healed = Math.min(amount, creature.damage);
  creature.damage -= healed;
  ctx.events.push({ type: 'CREATURE_HEALED', player: ctx.player, target: ref, amount: healed });
  return undefined;
};

/** params: { count }. */
const draw: EffectHandler = (ctx) => {
  const count = ctx.params.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    return { code: 'BAD_EFFECT_PARAMS', message: 'draw needs a positive integer count' };
  }
  const drawn = drawCards(ctx.state, ctx.player, count);
  if (drawn > 0) ctx.events.push({ type: 'CARD_DRAWN', player: ctx.player, count: drawn });
  return undefined;
};

/** Built-in handlers. Pass your own registry to applyAction to add more. */
export const defaultEffects: EffectRegistry = { heal, draw };
