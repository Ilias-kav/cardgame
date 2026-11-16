import {
  RULES,
  canPayCost,
  creatureCard,
  validateRetreatPayment,
  type Card,
  type CardCatalog,
  type CreatureCard,
  type CreatureInPlay,
  type CreatureRef,
  type PlayerIndex,
} from '@cardgame/engine';
import type { PlayerView } from '@cardgame/protocol';

/**
 * Helpers that let the UI enable/disable buttons and highlight targets. They only
 * mirror the rules so the interface feels responsive: the SERVER always has the final
 * say and every move is checked again there.
 */

/** Effect handlers that need the player to pick one of their creatures. */
export const HANDLERS_NEEDING_TARGET: ReadonlySet<string> = new Set(['heal']);

export interface Check {
  ok: boolean;
  reason?: string;
}
const yes: Check = { ok: true };
const no = (reason: string): Check => ({ ok: false, reason });

export function creatureAt(view: PlayerView, ref: CreatureRef): CreatureInPlay | null {
  if (ref.zone === 'active') return view.you.active;
  return view.you.bench[ref.index] ?? null;
}

/** All of my creatures in play, active first. */
export function myCreatures(view: PlayerView): Array<{ ref: CreatureRef; creature: CreatureInPlay }> {
  const out: Array<{ ref: CreatureRef; creature: CreatureInPlay }> = [];
  if (view.you.active) out.push({ ref: { zone: 'active' }, creature: view.you.active });
  view.you.bench.forEach((creature, index) => out.push({ ref: { zone: 'bench', index }, creature }));
  return out;
}

/** The players the game is waiting for right now (mirrors the server's turn timer logic). */
export function whoActs(view: PlayerView): PlayerIndex[] {
  if (view.outcome) return [];
  const opp: PlayerIndex = view.seat === 0 ? 1 : 0;
  if (view.phase === 'setup' && view.setup) {
    const out: PlayerIndex[] = [];
    if (!view.setup.you.placed) out.push(view.seat);
    if (!view.setup.opponent.placed) out.push(opp);
    return out;
  }
  if (view.phase !== 'playing') return [];
  if (view.pendingDecisions.length > 0) return [...new Set(view.pendingDecisions.map((d) => d.player))];
  return [view.currentPlayer];
}

export const mustPromote = (view: PlayerView): boolean =>
  !view.outcome && view.pendingDecisions.some((d) => d.player === view.seat && d.type === 'PROMOTE_ACTIVE');

/** It is my turn and I may play cards, attack or end the turn. */
export const canActInMainPhase = (view: PlayerView): boolean =>
  !view.outcome &&
  view.phase === 'playing' &&
  view.turnStage === 'main' &&
  view.pendingDecisions.length === 0 &&
  view.currentPlayer === view.seat;

export function attackCheck(
  catalog: CardCatalog,
  view: PlayerView,
  creature: CreatureInPlay,
  attackIndex: number,
): Check {
  if (!canActInMainPhase(view)) return no('Not your turn');
  const attack = creatureCard(catalog, creature).attacks[attackIndex];
  if (!attack) return no('No such attack');
  if (creature.status === 'asleep') return no('Asleep');
  if (creature.status === 'paralyzed') return no('Paralyzed');
  if (!canPayCost(catalog, creature.attached, attack.cost)) return no('Not enough power');
  return yes;
}

export function retreatCheck(view: PlayerView): Check {
  if (!canActInMainPhase(view)) return no('Not your turn');
  const active = view.you.active;
  if (!active) return no('No active creature');
  if (view.you.bench.length === 0) return no('Nobody on the bench');
  if (active.status === 'asleep') return no('Asleep');
  if (active.status === 'paralyzed') return no('Paralyzed');
  return yes;
}

export const retreatCostOf = (catalog: CardCatalog, creature: CreatureInPlay): number =>
  creatureCard(catalog, creature).retreatCost;

/** Null when the chosen power cards pay the retreat cost exactly; otherwise why not. */
export function retreatPaymentError(
  catalog: CardCatalog,
  creature: CreatureInPlay,
  discardIids: readonly string[],
): string | null {
  return validateRetreatPayment(catalog, creature.attached, discardIids, retreatCostOf(catalog, creature));
}

/** My creatures that `card` (a stage 1 or 2) could evolve right now. */
export function evolveTargets(catalog: CardCatalog, view: PlayerView, card: CreatureCard): CreatureRef[] {
  if (card.stage === 'basic') return [];
  const needed = card.stage === 'stage1' ? 'basic' : 'stage1';
  return myCreatures(view)
    .filter(({ creature }) => {
      const top = creatureCard(catalog, creature);
      if (top.stage !== needed || top.name !== card.evolvesFrom) return false;
      if (creature.playedOnTurn === view.turn) return false; // not on the turn it was played
      if (!RULES.allowMultipleEvolutionsPerTurn && creature.evolvedOnTurn === view.turn) return false;
      return true;
    })
    .map(({ ref }) => ref);
}

export function itemNeedsTarget(card: Card): boolean {
  return card.kind === 'item' && HANDLERS_NEEDING_TARGET.has(card.effect.handler);
}

export function abilityNeedsTarget(card: CreatureCard): boolean {
  return card.ability !== undefined && HANDLERS_NEEDING_TARGET.has(card.ability.effect.handler);
}

export const sameRef = (a: CreatureRef, b: CreatureRef): boolean =>
  a.zone === b.zone && (a.zone === 'active' || (b.zone === 'bench' && a.index === b.index));

/** "3/5" style turn clock: whole seconds left until `deadline` (epoch ms), never negative. */
export function secondsLeft(deadline: number | null, now: number): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** The headline above the board: whose move it is and what they are doing. */
export function turnStatus(view: PlayerView, names: [string, string]): string {
  if (view.outcome) return 'Game over';
  const opp: PlayerIndex = view.seat === 0 ? 1 : 0;
  if (view.phase === 'setup' && view.setup) {
    return view.setup.you.placed ? `Waiting for ${names[opp]} to place their creatures` : 'Set up your starting creatures';
  }
  if (view.pendingDecisions.length > 0) {
    return mustPromote(view)
      ? 'Choose your new active creature'
      : `${names[opp]} is choosing a new active creature`;
  }
  return view.currentPlayer === view.seat ? 'Your turn' : `${names[view.currentPlayer]}'s turn`;
}
