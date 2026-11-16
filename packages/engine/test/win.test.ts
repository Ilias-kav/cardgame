import { describe, expect, it } from 'vitest';
import { act, creature, eventsOfType, makeState, rejected } from './helpers.js';

const finisher = () => creature('bruiser', { attached: ['power-fire', 'power-fire', 'power-fire'] });

describe('win conditions', () => {
  it('taking the last prize wins immediately', () => {
    const s = makeState({
      p0: { active: finisher(), prizes: 1 },
      p1: { active: creature('wimp'), bench: [creature('sparky')] },
    });
    const { state, events } = act(s, 0, { type: 'ATTACK', attackIndex: 1 });
    expect(state.phase).toBe('finished');
    expect(state.result).toEqual({ winner: 0, reason: 'prizes' });
    expect(state.pendingDecisions).toHaveLength(0);
    expect(eventsOfType(events, 'GAME_OVER')).toHaveLength(1);
    expect(rejected(state, 1, { type: 'PROMOTE', benchIndex: 0 })).toBe('GAME_OVER');
  });

  it('knocking out the opponent\'s last creature wins, even with prizes left', () => {
    const s = makeState({
      p0: { active: finisher() },
      p1: { active: creature('wimp'), bench: [] },
    });
    const { state } = act(s, 0, { type: 'ATTACK', attackIndex: 1 });
    expect(state.result).toEqual({ winner: 0, reason: 'no_creatures' });
  });

  it('losing the active creature with a bench left is not a loss', () => {
    const s = makeState({
      p0: { active: finisher() },
      p1: { active: creature('wimp'), bench: [creature('sparky')] },
    });
    expect(act(s, 0, { type: 'ATTACK', attackIndex: 1 }).state.phase).toBe('playing');
  });
});

describe('simultaneous outcomes', () => {
  const doomed = () => creature('wimp', { damage: 15, poisoned: true });

  it('both lose their last creature: fewer prizes left wins', () => {
    const s = makeState({
      p0: { active: doomed(), prizes: 3 },
      p1: { active: doomed(), prizes: 6 },
    });
    const { state } = act(s, 0, { type: 'END_TURN' });
    expect(state.players[0].prizes).toHaveLength(2);
    expect(state.players[1].prizes).toHaveLength(5);
    expect(state.result).toEqual({ winner: 0, reason: 'no_creatures' });
  });

  it('both lose their last creature with equal prizes: sudden death (assumption)', () => {
    const s = makeState({ p0: { active: doomed() }, p1: { active: doomed() } });
    const { state } = act(s, 0, { type: 'END_TURN' });
    expect(state.result).toEqual({ winner: null, reason: 'sudden_death_rematch' });
  });

  it('both take their last prize at the same time: sudden death rematch', () => {
    const s = makeState({
      p0: { active: doomed(), bench: [creature('sparky')], prizes: 1 },
      p1: { active: doomed(), bench: [creature('sparky')], prizes: 1 },
    });
    const { state } = act(s, 0, { type: 'END_TURN' });
    expect(state.phase).toBe('finished');
    expect(state.result).toEqual({ winner: null, reason: 'sudden_death_rematch' });
  });
});
