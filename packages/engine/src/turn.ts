import type { CardCatalog } from './cards.js';
import type { EffectRegistry } from './effects.js';
import type { DamageSource, GameEvent } from './events.js';
import type { Rng } from './rng.js';
import { RULES } from './rules.js';
import type { GameResult, GameState, PlayerIndex } from './state.js';
import { creatureCard, drawCards, hasCreatures, otherPlayer } from './util.js';

/** Everything an engine step needs besides the state itself. */
export interface Env {
  catalog: CardCatalog;
  rng: Rng;
  events: GameEvent[];
  effects: EffectRegistry;
}

export function finish(state: GameState, events: GameEvent[], result: GameResult): void {
  state.phase = 'finished';
  state.result = result;
  state.pendingDecisions = [];
  events.push({ type: 'GAME_OVER', result });
}

/** Starts a turn: switch player, reset per-turn flags, draw (empty deck = loss). */
export function beginTurn(state: GameState, events: GameEvent[], player: PlayerIndex): void {
  state.turn += 1;
  state.currentPlayer = player;
  state.turnStage = 'main';
  state.players[player].powerAttachedThisTurn = false;
  events.push({ type: 'TURN_STARTED', player, turn: state.turn });

  if (state.players[player].deck.length === 0) {
    finish(state, events, { winner: otherPlayer(player), reason: 'deck_out' });
    return;
  }
  drawCards(state, player, 1);
  events.push({ type: 'CARD_DRAWN', player, count: 1 });
}

/** The taker draws one face-down prize into their hand (prizes were dealt at random). */
function takePrize(state: GameState, events: GameEvent[], taker: PlayerIndex): void {
  const prize = state.players[taker].prizes.shift();
  if (!prize) return;
  state.players[taker].hand.push(prize);
  events.push({ type: 'PRIZE_TAKEN', player: taker });
}

/** Discards the whole active creature, gives the opponent a prize, queues a promotion. */
export function knockOutActive(state: GameState, events: GameEvent[], owner: PlayerIndex): void {
  const p = state.players[owner];
  const creature = p.active;
  if (!creature) return;
  p.discard.push(...creature.stack, ...creature.attached);
  p.active = null;
  events.push({
    type: 'CREATURE_KNOCKED_OUT',
    player: owner,
    cardIds: creature.stack.map((c) => c.cardId),
  });
  takePrize(state, events, otherPlayer(owner));
  if (p.bench.length > 0) state.pendingDecisions.push({ player: owner, type: 'PROMOTE_ACTIVE' });
}

/** Deals damage to a player's active creature and knocks it out if hit points run out. */
export function dealDamage(
  catalog: CardCatalog,
  state: GameState,
  events: GameEvent[],
  owner: PlayerIndex,
  amount: number,
  source: DamageSource,
): void {
  const creature = state.players[owner].active;
  if (!creature || amount <= 0) return;
  creature.damage += amount;
  events.push({ type: 'DAMAGE', player: owner, target: { zone: 'active' }, amount, source });
  if (creature.damage >= creatureCard(catalog, creature).hp) knockOutActive(state, events, owner);
}

/**
 * Win conditions, checked together so simultaneous outcomes are handled:
 * a player claims a win by having taken all prizes or by the opponent having
 * no creature in play. If both claim, fewer prizes left wins; equal = sudden death.
 */
export function evaluateWin(state: GameState): GameResult | null {
  const claims: PlayerIndex[] = [];
  for (const p of [0, 1] as const) {
    if (state.players[p].prizes.length === 0 || !hasCreatures(state, otherPlayer(p))) claims.push(p);
  }
  if (claims.length === 0) return null;

  let winner: PlayerIndex;
  if (claims.length === 1) {
    winner = claims[0] as PlayerIndex;
  } else {
    const left0 = state.players[0].prizes.length;
    const left1 = state.players[1].prizes.length;
    if (left0 === left1) return { winner: null, reason: 'sudden_death_rematch' };
    winner = left0 < left1 ? 0 : 1;
  }
  return {
    winner,
    reason: state.players[winner].prizes.length === 0 ? 'prizes' : 'no_creatures',
  };
}

/**
 * Between-turns checkup, in this order:
 *  1. poison: 10 damage to the active creatures of both players, the player whose
 *     turn just ended first (no weakness/resistance)
 *  2. asleep: only the player whose turn is about to start flips; heads = wakes up
 *  3. paralysis of the player whose turn just ended wears off
 */
function runCheckup(state: GameState, env: Env): void {
  const ended = state.currentPlayer;
  const next = otherPlayer(ended);

  for (const p of [ended, next]) {
    if (state.players[p].active?.poisoned) {
      dealDamage(env.catalog, state, env.events, p, RULES.poisonDamage, 'poison');
    }
  }

  const sleeper = state.players[next].active;
  if (sleeper?.status === 'asleep') {
    const heads = env.rng.coinFlip();
    env.events.push({ type: 'COIN_FLIP', purpose: 'sleep_wake', heads, player: next });
    if (heads) {
      sleeper.status = null;
      env.events.push({ type: 'STATUS_REMOVED', player: next, status: 'asleep' });
    }
  }

  const mine = state.players[ended].active;
  if (mine?.status === 'paralyzed') {
    mine.status = null;
    env.events.push({ type: 'STATUS_REMOVED', player: ended, status: 'paralyzed' });
  }
}

/**
 * Runs after every action. Decides the game if a win condition is met, waits
 * while a player still has to decide something, and otherwise carries a
 * finished turn through the checkup into the next player's turn.
 */
export function settle(state: GameState, env: Env): void {
  for (let guard = 0; guard < 10; guard++) {
    if (state.phase !== 'playing') return;

    const result = evaluateWin(state);
    if (result) {
      finish(state, env.events, result);
      return;
    }
    if (state.pendingDecisions.length > 0) return;

    if (state.turnStage === 'main') return;
    if (state.turnStage === 'ending') {
      runCheckup(state, env);
      state.turnStage = 'between';
    } else {
      beginTurn(state, env.events, otherPlayer(state.currentPlayer));
    }
  }
  throw new Error('settle did not terminate');
}
