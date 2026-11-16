import { starterCatalog, type CreatureCard, type CreatureInPlay } from '@cardgame/engine';
import type { PlayerView } from '@cardgame/protocol';
import { describe, expect, it } from 'vitest';
import {
  attackCheck,
  canActInMainPhase,
  evolveTargets,
  itemNeedsTarget,
  mustPromote,
  retreatCheck,
  retreatPaymentError,
  sameRef,
  secondsLeft,
  turnStatus,
  whoActs,
} from '../src/game/hints.js';
import { playingState, viewOf } from './helpers.js';

const catalog = starterCatalog;
const creature = (cardId: string, o: Partial<CreatureInPlay> & { power?: string[] } = {}): CreatureInPlay => ({
  stack: [{ iid: `c-${cardId}`, cardId }],
  attached: (o.power ?? []).map((p, i) => ({ iid: `a${i}`, cardId: p })),
  damage: o.damage ?? 0,
  status: o.status ?? null,
  poisoned: o.poisoned ?? false,
  playedOnTurn: o.playedOnTurn ?? 0,
  evolvedOnTurn: o.evolvedOnTurn ?? 0,
});

/** My turn, turn 5, in the main phase. */
function myTurn(): PlayerView {
  const state = playingState();
  const seat = state.currentPlayer;
  return { ...viewOf(state, seat), turn: 5 };
}

describe('whoActs / turn state', () => {
  it('during setup both players are expected until they place', () => {
    const view = { ...myTurn(), phase: 'setup' as const, setup: {
      you: { extraDrawAvailable: 0, extraDrawResolved: true, placed: false, mulligans: 0 },
      opponent: { extraDrawAvailable: 0, extraDrawResolved: true, placed: true, mulligans: 0 },
    } };
    expect(whoActs(view)).toEqual([view.seat]);
    view.setup!.opponent.placed = false;
    expect(whoActs(view)).toHaveLength(2);
  });

  it('in play it is the current player, or whoever has to promote', () => {
    const v = myTurn();
    expect(whoActs(v)).toEqual([v.currentPlayer]);
    expect(canActInMainPhase(v)).toBe(true);
    const other = v.seat === 0 ? 1 : 0;
    expect(canActInMainPhase({ ...v, currentPlayer: other })).toBe(false);
    const promoting = { ...v, pendingDecisions: [{ player: v.seat, type: 'PROMOTE_ACTIVE' as const }] };
    expect(whoActs(promoting)).toEqual([v.seat]);
    expect(mustPromote(promoting)).toBe(true);
    expect(canActInMainPhase(promoting)).toBe(false);
  });

  it('nobody acts once the game has an outcome', () => {
    const v = { ...myTurn(), outcome: { winner: 0 as const, reason: 'prizes' as const } };
    expect(whoActs(v)).toEqual([]);
    expect(canActInMainPhase(v)).toBe(false);
  });
});

describe('attackCheck', () => {
  const v = myTurn();

  it('needs the power cards from the attack cost', () => {
    // Embercub: Scratch costs 1 neutral, Flame Burst costs fire + neutral
    expect(attackCheck(catalog, v, creature('embercub'), 0)).toEqual({ ok: false, reason: 'Not enough power' });
    expect(attackCheck(catalog, v, creature('embercub', { power: ['power-water'] }), 0).ok).toBe(true);
    expect(attackCheck(catalog, v, creature('embercub', { power: ['power-water'] }), 1).ok).toBe(false);
    expect(attackCheck(catalog, v, creature('embercub', { power: ['power-fire', 'power-water'] }), 1).ok).toBe(true);
    expect(attackCheck(catalog, v, creature('embercub', { power: ['power-double-neutral'] }), 0).ok).toBe(true);
  });

  it('refuses asleep or paralyzed creatures and unknown attacks', () => {
    const armed = ['power-fire', 'power-fire'];
    expect(attackCheck(catalog, v, creature('embercub', { power: armed, status: 'asleep' }), 0).reason).toBe('Asleep');
    expect(attackCheck(catalog, v, creature('embercub', { power: armed, status: 'paralyzed' }), 0).reason).toBe('Paralyzed');
    expect(attackCheck(catalog, v, creature('embercub', { power: armed, status: 'confused' }), 0).ok).toBe(true);
    expect(attackCheck(catalog, v, creature('embercub', { power: armed }), 9).reason).toBe('No such attack');
  });

  it('refuses when it is not your turn', () => {
    const other = v.seat === 0 ? 1 : 0;
    expect(attackCheck(catalog, { ...v, currentPlayer: other }, creature('embercub', { power: ['power-fire'] }), 0).reason).toBe(
      'Not your turn',
    );
  });
});

describe('retreat', () => {
  it('needs a bench and a creature that is not asleep or paralyzed', () => {
    const v = myTurn();
    const withBench = { ...v, you: { ...v.you, active: creature('embercub'), bench: [creature('pondling')] } };
    expect(retreatCheck(withBench).ok).toBe(true);
    expect(retreatCheck({ ...withBench, you: { ...withBench.you, bench: [] } }).reason).toBe('Nobody on the bench');
    expect(retreatCheck({ ...withBench, you: { ...withBench.you, active: creature('embercub', { status: 'asleep' }) } }).reason).toBe('Asleep');
  });

  it('checks the chosen payment against the retreat cost', () => {
    const c = creature('blazewolf', { power: ['power-fire', 'power-fire', 'power-water'] }); // retreat cost 2
    expect(retreatPaymentError(catalog, c, [])).toContain('costs 2');
    expect(retreatPaymentError(catalog, c, ['a0', 'a1'])).toBeNull();
    expect(retreatPaymentError(catalog, c, ['a0', 'a1', 'a2'])).toContain('more cards than necessary');
    expect(retreatPaymentError(catalog, c, ['nope'])).toContain('not attached');
  });
});

describe('evolveTargets', () => {
  const blazewolf = catalog.blazewolf as CreatureCard;
  const base = () => myTurn();

  it('finds creatures of the right line that were not just played', () => {
    const v = base();
    const view = { ...v, turn: 5, you: { ...v.you, active: creature('embercub', { playedOnTurn: 1 }), bench: [creature('pondling', { playedOnTurn: 1 }), creature('embercub', { playedOnTurn: 5 })] } };
    expect(evolveTargets(catalog, view, blazewolf)).toEqual([{ zone: 'active' }]);
  });

  it('needs the previous stage: stage 2 only on stage 1, nothing for basics', () => {
    const v = base();
    const stage1 = { ...creature('blazewolf', { playedOnTurn: 1 }), stack: [{ iid: 'x', cardId: 'embercub' }, { iid: 'y', cardId: 'blazewolf' }] };
    const view = { ...v, turn: 5, you: { ...v.you, active: creature('embercub', { playedOnTurn: 1 }), bench: [stage1] } };
    expect(evolveTargets(catalog, view, catalog.infernowolf as CreatureCard)).toEqual([{ zone: 'bench', index: 0 }]);
    expect(evolveTargets(catalog, view, catalog.embercub as CreatureCard)).toEqual([]);
  });

  it('a creature that already evolved this turn is not a target', () => {
    const v = base();
    const view = { ...v, turn: 5, you: { ...v.you, active: creature('embercub', { playedOnTurn: 1, evolvedOnTurn: 5 }), bench: [] } };
    expect(evolveTargets(catalog, view, blazewolf)).toEqual([]);
  });
});

describe('small helpers', () => {
  it('knows which items need a target creature', () => {
    expect(itemNeedsTarget(catalog.potion!)).toBe(true);
    expect(itemNeedsTarget(catalog['quick-draw']!)).toBe(false);
    expect(itemNeedsTarget(catalog['power-fire']!)).toBe(false);
  });

  it('compares creature references', () => {
    expect(sameRef({ zone: 'active' }, { zone: 'active' })).toBe(true);
    expect(sameRef({ zone: 'bench', index: 1 }, { zone: 'bench', index: 1 })).toBe(true);
    expect(sameRef({ zone: 'bench', index: 1 }, { zone: 'bench', index: 2 })).toBe(false);
    expect(sameRef({ zone: 'active' }, { zone: 'bench', index: 0 })).toBe(false);
  });

  it('counts seconds left, never below zero', () => {
    expect(secondsLeft(null, 1000)).toBeNull();
    expect(secondsLeft(11_500, 1000)).toBe(11);
    expect(secondsLeft(1000, 5000)).toBe(0);
  });
});

describe('turnStatus', () => {
  const names: [string, string] = ['alice', 'bob'];
  it('describes whose move it is', () => {
    const v = myTurn();
    const other = v.seat === 0 ? 1 : 0;
    expect(turnStatus(v, names)).toBe('Your turn');
    expect(turnStatus({ ...v, currentPlayer: other }, names)).toBe(`${names[other]}'s turn`);
    expect(turnStatus({ ...v, pendingDecisions: [{ player: v.seat, type: 'PROMOTE_ACTIVE' }] }, names)).toBe('Choose your new active creature');
    expect(turnStatus({ ...v, pendingDecisions: [{ player: other, type: 'PROMOTE_ACTIVE' }] }, names)).toContain('is choosing a new active creature');
    expect(turnStatus({ ...v, outcome: { winner: 0, reason: 'prizes' } }, names)).toBe('Game over');
  });
});
