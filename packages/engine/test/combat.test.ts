import { describe, expect, it } from 'vitest';
import { act, creature, eventsOfType, makeState, rejected } from './helpers.js';

describe('ATTACK: power cost', () => {
  it('needs the right typed power cards attached', () => {
    const none = makeState({ p0: { active: creature('sparky') } });
    expect(rejected(none, 0, { type: 'ATTACK', attackIndex: 0 })).toBe('NOT_ENOUGH_POWER');
    const wrong = makeState({ p0: { active: creature('sparky', { attached: ['power-fire'] }) } });
    expect(rejected(wrong, 0, { type: 'ATTACK', attackIndex: 0 })).toBe('NOT_ENOUGH_POWER');
    const right = makeState({ p0: { active: creature('sparky', { attached: ['power-lightning'] }) } });
    expect(act(right, 0, { type: 'ATTACK', attackIndex: 0 }).state.players[1].active!.damage).toBe(10);
  });

  it('neutral symbols can be paid by any power card', () => {
    const s = makeState({ p0: { active: creature('sparkling', { attached: ['power-lightning', 'power-fire'] }) } });
    expect(act(s, 0, { type: 'ATTACK', attackIndex: 0 }).state.players[1].active!.damage).toBe(40);
  });

  it('double neutral counts as two neutral, but cannot pay a typed symbol', () => {
    const big = makeState({ p0: { active: creature('bruiser', { attached: ['power-double-neutral', 'power-fire'] }) } });
    expect(act(big, 0, { type: 'ATTACK', attackIndex: 1 }).state.players[1].active!.damage).toBe(90);
    const short = makeState({ p0: { active: creature('bruiser', { attached: ['power-double-neutral'] }) } });
    expect(rejected(short, 0, { type: 'ATTACK', attackIndex: 1 })).toBe('NOT_ENOUGH_POWER');
    const typed = makeState({ p0: { active: creature('sparky', { attached: ['power-double-neutral'] }) } });
    expect(rejected(typed, 0, { type: 'ATTACK', attackIndex: 0 })).toBe('NOT_ENOUGH_POWER');
  });

  it('rejects an attack that does not exist', () => {
    const s = makeState({ p0: { active: creature('bruiser', { attached: ['power-fire'] }) } });
    expect(rejected(s, 0, { type: 'ATTACK', attackIndex: 7 })).toBe('INVALID_ATTACK');
    expect(rejected(s, 0, { type: 'ATTACK', attackIndex: -1 })).toBe('INVALID_ATTACK');
  });
});

describe('ATTACK: turn rules', () => {
  it('the first player can attack on their first turn', () => {
    const s = makeState({ turn: 1, current: 0, p0: { active: creature('bruiser', { attached: ['power-fire'] }) } });
    const { state } = act(s, 0, { type: 'ATTACK', attackIndex: 0 });
    expect(state.players[1].active!.damage).toBe(30);
  });

  it('an attack ends the turn', () => {
    const s = makeState({ p0: { active: creature('bruiser', { attached: ['power-fire'] }) } });
    const { state } = act(s, 0, { type: 'ATTACK', attackIndex: 0 });
    expect(state.currentPlayer).toBe(1);
    expect(state.turn).toBe(6);
    expect(rejected(state, 0, { type: 'ATTACK', attackIndex: 0 })).toBe('NOT_YOUR_TURN');
  });

  it('damage accumulates on the defender across turns', () => {
    const s = makeState({
      p0: { active: creature('bruiser', { attached: ['power-fire'] }) },
      p1: { active: creature('bruiser') },
    });
    const a = act(s, 0, { type: 'ATTACK', attackIndex: 0 });
    const b = act(a.state, 1, { type: 'END_TURN' });
    const c = act(b.state, 0, { type: 'ATTACK', attackIndex: 0 });
    expect(c.state.players[1].active!.damage).toBe(60);
  });

  it('an evolved creature uses the attacks of its newest card', () => {
    const s = makeState({
      p0: { active: creature('sparkling', { stack: ['sparky', 'sparkling'], attached: ['power-lightning', 'power-fire'] }) },
    });
    expect(act(s, 0, { type: 'ATTACK', attackIndex: 0 }).state.players[1].active!.damage).toBe(40);
  });
});

describe('ATTACK: weakness and resistance', () => {
  it('weakness doubles damage', () => {
    const s = makeState({
      p0: { active: creature('splasher', { attached: ['power-water'] }) },
      p1: { active: creature('rocky') },
    });
    expect(act(s, 0, { type: 'ATTACK', attackIndex: 0 }).state.players[1].active!.damage).toBe(60);
  });

  it('resistance subtracts 30, never below zero', () => {
    const strong = makeState({
      p0: { active: creature('sparkling', { attached: ['power-lightning', 'power-fire'] }) },
      p1: { active: creature('rocky') },
    });
    expect(act(strong, 0, { type: 'ATTACK', attackIndex: 0 }).state.players[1].active!.damage).toBe(10);

    const weak = makeState({
      p0: { active: creature('sparky', { attached: ['power-lightning'] }) },
      p1: { active: creature('rocky') },
    });
    const r = act(weak, 0, { type: 'ATTACK', attackIndex: 0 });
    expect(r.state.players[1].active!.damage).toBe(0);
    expect(eventsOfType(r.events, 'DAMAGE')).toHaveLength(0);
  });
});

describe('knockouts', () => {
  const koState = () =>
    makeState({
      turn: 5,
      p0: { active: creature('bruiser', { attached: ['power-fire', 'power-fire', 'power-fire'] }), hand: [] },
      p1: {
        active: creature('wimp', { attached: ['power-water'] }),
        bench: [creature('sparky')],
        discard: [],
      },
    });

  it('discards everything, gives the attacker a prize, and waits for the promotion', () => {
    const { state, events } = act(koState(), 0, { type: 'ATTACK', attackIndex: 1 });
    expect(state.players[1].active).toBeNull();
    expect(state.players[1].discard.map((c) => c.cardId).sort()).toEqual(['power-water', 'wimp']);
    expect(state.players[0].prizes).toHaveLength(5);
    expect(state.players[0].hand).toHaveLength(1); // the prize goes to the hand
    expect(state.pendingDecisions).toEqual([{ player: 1, type: 'PROMOTE_ACTIVE' }]);
    expect(state.turn).toBe(5);
    expect(state.turnStage).toBe('ending');
    expect(eventsOfType(events, 'PRIZE_TAKEN')).toHaveLength(1);
    expect(eventsOfType(events, 'CREATURE_KNOCKED_OUT')).toHaveLength(1);
  });

  it('blocks other actions until the defender promotes, then the next turn begins', () => {
    const { state } = act(koState(), 0, { type: 'ATTACK', attackIndex: 1 });
    expect(rejected(state, 1, { type: 'END_TURN' })).toBe('DECISION_PENDING');
    expect(rejected(state, 0, { type: 'END_TURN' })).toBe('DECISION_PENDING');
    expect(rejected(state, 0, { type: 'PROMOTE', benchIndex: 0 })).toBe('NO_PENDING_DECISION');
    expect(rejected(state, 1, { type: 'PROMOTE', benchIndex: 4 })).toBe('INVALID_BENCH');

    const next = act(state, 1, { type: 'PROMOTE', benchIndex: 0 });
    expect(next.state.players[1].active!.stack[0]!.cardId).toBe('sparky');
    expect(next.state.players[1].bench).toHaveLength(0);
    expect(next.state.pendingDecisions).toHaveLength(0);
    expect(next.state.turn).toBe(6);
    expect(next.state.currentPlayer).toBe(1);
    expect(next.state.players[1].hand).toHaveLength(1); // drew for the new turn
  });

  it('an evolved creature sends its whole evolution stack to the discard pile', () => {
    const s = makeState({
      p0: { active: creature('bruiser', { attached: ['power-fire', 'power-fire', 'power-fire'] }) },
      p1: {
        active: creature('sparkling', { stack: ['sparky', 'sparkling'], damage: 40 }),
        bench: [creature('wimp')],
      },
    });
    const { state } = act(s, 0, { type: 'ATTACK', attackIndex: 1 });
    expect(state.players[1].discard.map((c) => c.cardId).sort()).toEqual(['sparkling', 'sparky']);
  });
});
