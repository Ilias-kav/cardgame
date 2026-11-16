import type { Action, CreatureRef } from './actions.js';
import { getCard, isBasicCreature, type AttackEffect } from './cards.js';
import { computeAttackDamage } from './damage.js';
import type { CoinPurpose, StatusName } from './events.js';
import { canPayCost, validateRetreatPayment } from './energy.js';
import type { EngineError } from './result.js';
import { RULES } from './rules.js';
import type { CardInstance, CreatureInPlay, GameState, PlayerIndex, PlayerState } from './state.js';
import { dealDamage, type Env } from './turn.js';
import { creatureCard, newCreature, otherPlayer, resolveRef } from './util.js';

/** Context of one action: a mutable copy of the state and who is acting. */
export interface Cx {
  state: GameState;
  env: Env;
  player: PlayerIndex;
}

type Failure = EngineError | undefined;

const fail = (code: string, message: string): EngineError => ({ code, message });

function takeFromHand(p: PlayerState, iid: string): CardInstance | null {
  const idx = p.hand.findIndex((c) => c.iid === iid);
  if (idx < 0) return null;
  return p.hand.splice(idx, 1)[0] ?? null;
}

function flip(cx: Cx, purpose: CoinPurpose, player: PlayerIndex = cx.player): boolean {
  const heads = cx.env.rng.coinFlip();
  cx.env.events.push({ type: 'COIN_FLIP', purpose, heads, player });
  return heads;
}

function clearStatuses(cx: Cx, owner: PlayerIndex, creature: CreatureInPlay): void {
  const removed: StatusName[] = [];
  if (creature.status) removed.push(creature.status);
  if (creature.poisoned) removed.push('poisoned');
  creature.status = null;
  creature.poisoned = false;
  for (const status of removed) cx.env.events.push({ type: 'STATUS_REMOVED', player: owner, status });
}

function endTurn(cx: Cx): void {
  cx.state.turnStage = 'ending';
  cx.env.events.push({ type: 'TURN_ENDED', player: cx.player });
}

function playBasic(cx: Cx, iid: string): Failure {
  const me = cx.state.players[cx.player];
  const card = takeFromHand(me, iid);
  if (!card) return fail('NOT_IN_HAND', `Card ${iid} is not in your hand`);
  if (!isBasicCreature(getCard(cx.env.catalog, card.cardId))) {
    return fail('NOT_BASIC', 'Only basic creatures can be played to the bench');
  }
  if (me.bench.length >= RULES.benchSize) return fail('BENCH_FULL', 'Your bench is full');
  me.bench.push(newCreature(card, cx.state.turn));
  cx.env.events.push({
    type: 'CREATURE_PLAYED',
    player: cx.player,
    cardId: card.cardId,
    benchIndex: me.bench.length - 1,
  });
  return undefined;
}

function attachPower(cx: Cx, iid: string, target: CreatureRef): Failure {
  const me = cx.state.players[cx.player];
  if (me.powerAttachedThisTurn) return fail('POWER_ALREADY_ATTACHED', 'One power card per turn');
  const creature = resolveRef(cx.state, cx.player, target);
  if (!creature) return fail('INVALID_TARGET', 'No such creature');
  const card = takeFromHand(me, iid);
  if (!card) return fail('NOT_IN_HAND', `Card ${iid} is not in your hand`);
  if (getCard(cx.env.catalog, card.cardId).kind !== 'power') {
    return fail('NOT_POWER', 'Only power cards can be attached');
  }
  creature.attached.push(card);
  me.powerAttachedThisTurn = true;
  cx.env.events.push({ type: 'POWER_ATTACHED', player: cx.player, cardId: card.cardId, target });
  return undefined;
}

function evolve(cx: Cx, iid: string, target: CreatureRef): Failure {
  const me = cx.state.players[cx.player];
  const creature = resolveRef(cx.state, cx.player, target);
  if (!creature) return fail('INVALID_TARGET', 'No such creature');
  const card = takeFromHand(me, iid);
  if (!card) return fail('NOT_IN_HAND', `Card ${iid} is not in your hand`);
  const def = getCard(cx.env.catalog, card.cardId);
  if (def.kind !== 'creature' || def.stage === 'basic') {
    return fail('NOT_EVOLUTION', 'Only stage 1 and stage 2 creatures can evolve a creature');
  }

  const current = creatureCard(cx.env.catalog, creature);
  const requiredStage = def.stage === 'stage1' ? 'basic' : 'stage1';
  if (current.stage !== requiredStage || current.name !== def.evolvesFrom) {
    return fail('WRONG_EVOLUTION', `${def.name} cannot evolve from ${current.name}`);
  }
  if (creature.playedOnTurn === cx.state.turn) {
    return fail('JUST_PLAYED', 'A creature cannot evolve the turn it was played');
  }
  if (!RULES.allowMultipleEvolutionsPerTurn && creature.evolvedOnTurn === cx.state.turn) {
    return fail('ALREADY_EVOLVED', 'A creature can only evolve once per turn');
  }

  creature.stack.push(card);
  creature.evolvedOnTurn = cx.state.turn;
  clearStatuses(cx, cx.player, creature);
  cx.env.events.push({ type: 'EVOLVED', player: cx.player, cardId: card.cardId, target });
  return undefined;
}

function playItem(cx: Cx, iid: string, input: Record<string, unknown>): Failure {
  const me = cx.state.players[cx.player];
  const card = takeFromHand(me, iid);
  if (!card) return fail('NOT_IN_HAND', `Card ${iid} is not in your hand`);
  const def = getCard(cx.env.catalog, card.cardId);
  if (def.kind !== 'item') return fail('NOT_ITEM', 'That is not an item card');
  const handler = cx.env.effects[def.effect.handler];
  if (!handler) return fail('UNKNOWN_EFFECT', `No effect handler "${def.effect.handler}"`);

  cx.env.events.push({ type: 'ITEM_PLAYED', player: cx.player, cardId: card.cardId });
  const error = handler({
    catalog: cx.env.catalog,
    state: cx.state,
    rng: cx.env.rng,
    events: cx.env.events,
    player: cx.player,
    params: def.effect.params ?? {},
    input,
  });
  if (error) return error;
  me.discard.push(card);
  return undefined;
}

function useAbility(cx: Cx, target: CreatureRef, input: Record<string, unknown>): Failure {
  const creature = resolveRef(cx.state, cx.player, target);
  if (!creature) return fail('INVALID_TARGET', 'No such creature');
  const ability = creatureCard(cx.env.catalog, creature).ability;
  if (!ability) return fail('NO_ABILITY', 'That creature has no ability');
  const handler = cx.env.effects[ability.effect.handler];
  if (!handler) return fail('UNKNOWN_EFFECT', `No effect handler "${ability.effect.handler}"`);

  cx.env.events.push({ type: 'ABILITY_USED', player: cx.player, target });
  return handler({
    catalog: cx.env.catalog,
    state: cx.state,
    rng: cx.env.rng,
    events: cx.env.events,
    player: cx.player,
    params: ability.effect.params ?? {},
    input,
    source: target,
  });
}

function retreat(cx: Cx, benchIndex: number, discard: string[]): Failure {
  const me = cx.state.players[cx.player];
  const active = me.active;
  if (!active) return fail('NO_ACTIVE', 'You have no active creature');
  if (active.status === 'asleep') return fail('ASLEEP', 'An asleep creature cannot retreat');
  if (active.status === 'paralyzed') return fail('PARALYZED', 'A paralyzed creature cannot retreat');
  if (!Number.isInteger(benchIndex) || !me.bench[benchIndex]) {
    return fail('INVALID_BENCH', 'Choose a creature on your bench');
  }
  if (!Array.isArray(discard)) return fail('INVALID_PAYMENT', 'discard must be a list');

  const cost = creatureCard(cx.env.catalog, active).retreatCost;
  const problem = validateRetreatPayment(cx.env.catalog, active.attached, discard, cost);
  if (problem) return fail('INVALID_PAYMENT', problem);

  // The cost is paid even if a confused creature then fails to retreat.
  me.discard.push(...active.attached.filter((c) => discard.includes(c.iid)));
  active.attached = active.attached.filter((c) => !discard.includes(c.iid));

  if (active.status === 'confused' && !flip(cx, 'confusion_retreat')) {
    cx.env.events.push({ type: 'RETREAT_FAILED', player: cx.player });
    return undefined;
  }

  const incoming = me.bench[benchIndex] as CreatureInPlay;
  clearStatuses(cx, cx.player, active);
  me.bench[benchIndex] = active;
  me.active = incoming;
  cx.env.events.push({ type: 'RETREATED', player: cx.player, benchIndex });
  return undefined;
}

function applyAttackEffect(cx: Cx, effect: AttackEffect, defender: CreatureInPlay): Failure {
  const opponent = otherPlayer(cx.player);
  if (effect.condition) {
    let heads = 0;
    for (let i = 0; i < effect.condition.flips; i++) {
      if (flip(cx, 'attack_effect')) heads++;
    }
    if (heads < effect.condition.needed) return undefined;
  }
  switch (effect.kind) {
    case 'status':
      defender.status = effect.status; // a new status replaces the old one
      cx.env.events.push({ type: 'STATUS_APPLIED', player: opponent, status: effect.status });
      return undefined;
    case 'poison':
      defender.poisoned = true; // poison stacks with the other statuses
      cx.env.events.push({ type: 'STATUS_APPLIED', player: opponent, status: 'poisoned' });
      return undefined;
    case 'custom': {
      const handler = cx.env.effects[effect.handler];
      if (!handler) return fail('UNKNOWN_EFFECT', `No effect handler "${effect.handler}"`);
      return handler({
        catalog: cx.env.catalog,
        state: cx.state,
        rng: cx.env.rng,
        events: cx.env.events,
        player: cx.player,
        params: effect.params ?? {},
        input: {},
        source: { zone: 'active' },
      });
    }
  }
}

function attack(cx: Cx, attackIndex: number): Failure {
  const { state, env } = cx;
  const me = state.players[cx.player];
  const opponent = otherPlayer(cx.player);
  const active = me.active;
  if (!active) return fail('NO_ACTIVE', 'You have no active creature');

  const card = creatureCard(env.catalog, active);
  const atk = Number.isInteger(attackIndex) ? card.attacks[attackIndex] : undefined;
  if (!atk) return fail('INVALID_ATTACK', 'No such attack');
  if (active.status === 'asleep') return fail('ASLEEP', 'An asleep creature cannot attack');
  if (active.status === 'paralyzed') return fail('PARALYZED', 'A paralyzed creature cannot attack');
  if (!canPayCost(env.catalog, active.attached, atk.cost)) {
    return fail('NOT_ENOUGH_POWER', `${atk.name} needs more power cards attached`);
  }
  const target = state.players[opponent].active;
  if (!target) return fail('NO_TARGET', 'The opponent has no active creature');

  if (active.status === 'confused' && !flip(cx, 'confusion_attack')) {
    // Tails: no attack, the creature hurts itself, and the turn is over.
    const self = computeAttackDamage(RULES.confusionSelfDamage, card, card).amount;
    dealDamage(env.catalog, state, env.events, cx.player, self, 'confusion');
    endTurn(cx);
    return undefined;
  }

  env.events.push({ type: 'ATTACK_DECLARED', player: cx.player, attack: atk.name });
  const { amount } = computeAttackDamage(atk.damage, card, creatureCard(env.catalog, target));
  dealDamage(env.catalog, state, env.events, opponent, amount, 'attack');

  // The effect only applies if the defender survived the damage.
  const survivor = state.players[opponent].active;
  if (survivor && atk.effect) {
    const error = applyAttackEffect(cx, atk.effect, survivor);
    if (error) return error;
  }
  endTurn(cx);
  return undefined;
}

function promote(cx: Cx, benchIndex: number): Failure {
  const { state } = cx;
  const me = state.players[cx.player];
  const idx = state.pendingDecisions.findIndex(
    (d) => d.player === cx.player && d.type === 'PROMOTE_ACTIVE',
  );
  if (idx < 0) return fail('NO_PENDING_DECISION', 'You have nothing to promote');
  if (me.active) return fail('ALREADY_ACTIVE', 'You already have an active creature');
  if (!Number.isInteger(benchIndex) || !me.bench[benchIndex]) {
    return fail('INVALID_BENCH', 'Choose a creature on your bench');
  }
  me.active = me.bench.splice(benchIndex, 1)[0] as CreatureInPlay;
  state.pendingDecisions.splice(idx, 1);
  cx.env.events.push({ type: 'PROMOTED', player: cx.player, benchIndex });
  return undefined;
}

/** Runs one in-game (non-setup) action against a mutable copy of the state. */
export function runMainAction(cx: Cx, action: Action): Failure {
  switch (action.type) {
    case 'PLAY_BASIC':
      return playBasic(cx, action.iid);
    case 'ATTACH_POWER':
      return attachPower(cx, action.iid, action.target);
    case 'EVOLVE':
      return evolve(cx, action.iid, action.target);
    case 'PLAY_ITEM':
      return playItem(cx, action.iid, action.params ?? {});
    case 'USE_ABILITY':
      return useAbility(cx, action.target, action.params ?? {});
    case 'RETREAT':
      return retreat(cx, action.benchIndex, action.discard);
    case 'ATTACK':
      return attack(cx, action.attackIndex);
    case 'END_TURN':
      endTurn(cx);
      return undefined;
    case 'PROMOTE':
      return promote(cx, action.benchIndex);
    case 'SETUP_DRAW_EXTRA':
    case 'SETUP_PLACE':
      return fail('WRONG_PHASE', 'Setup is over');
  }
}
