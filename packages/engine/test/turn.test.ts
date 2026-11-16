import { describe, expect, it } from 'vitest';
import { act, creature, eventsOfType, iidOf, makeState, rejected } from './helpers.js';

describe('turn flow', () => {
  it('END_TURN passes the turn and the next player draws a card', () => {
    const s = makeState({ turn: 5, current: 0, p1: { deck: 3 } });
    const { state, events } = act(s, 0, { type: 'END_TURN' });
    expect(state.currentPlayer).toBe(1);
    expect(state.turn).toBe(6);
    expect(state.turnStage).toBe('main');
    expect(state.players[1].hand).toHaveLength(1);
    expect(state.players[1].deck).toHaveLength(2);
    expect(eventsOfType(events, 'TURN_STARTED')).toHaveLength(1);
  });

  it('does not mutate the state it was given', () => {
    const s = makeState();
    const before = JSON.stringify(s);
    act(s, 0, { type: 'END_TURN' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('only the current player may act', () => {
    const s = makeState({ current: 0 });
    expect(rejected(s, 1, { type: 'END_TURN' })).toBe('NOT_YOUR_TURN');
  });

  it('a player who cannot draw at the start of their turn loses', () => {
    const s = makeState({ p1: { deck: 0 } });
    const { state } = act(s, 0, { type: 'END_TURN' });
    expect(state.phase).toBe('finished');
    expect(state.result).toEqual({ winner: 0, reason: 'deck_out' });
    expect(rejected(state, 1, { type: 'END_TURN' })).toBe('GAME_OVER');
  });

  it('resets the once-per-turn power attachment', () => {
    const s = makeState({ p0: { hand: ['power-fire'] } });
    const a = act(s, 0, { type: 'ATTACH_POWER', iid: s.players[0].hand[0]!.iid, target: { zone: 'active' } });
    expect(a.state.players[0].powerAttachedThisTurn).toBe(true);
    const b = act(a.state, 0, { type: 'END_TURN' });
    const c = act(b.state, 1, { type: 'END_TURN' });
    expect(c.state.currentPlayer).toBe(0);
    expect(c.state.players[0].powerAttachedThisTurn).toBe(false);
  });
});

describe('PLAY_BASIC', () => {
  it('puts a basic creature on the bench, remembering the turn', () => {
    const s = makeState({ turn: 5, p0: { hand: ['sparky'] } });
    const { state } = act(s, 0, { type: 'PLAY_BASIC', iid: s.players[0].hand[0]!.iid });
    expect(state.players[0].bench).toHaveLength(1);
    expect(state.players[0].bench[0]!.playedOnTurn).toBe(5);
    expect(state.players[0].hand).toHaveLength(0);
  });

  it('rejects a full bench, non-basic cards and cards not in hand', () => {
    const full = makeState({
      p0: { hand: ['sparky'], bench: Array.from({ length: 5 }, () => creature('wimp')) },
    });
    expect(rejected(full, 0, { type: 'PLAY_BASIC', iid: full.players[0].hand[0]!.iid })).toBe('BENCH_FULL');

    const s = makeState({ p0: { hand: ['sparkling', 'potion'] } });
    for (const c of s.players[0].hand) {
      expect(rejected(s, 0, { type: 'PLAY_BASIC', iid: c.iid })).toBe('NOT_BASIC');
    }
    expect(rejected(s, 0, { type: 'PLAY_BASIC', iid: 'nope' })).toBe('NOT_IN_HAND');
  });
});

describe('ATTACH_POWER', () => {
  it('attaches to the active or a benched creature, once per turn', () => {
    const s = makeState({ p0: { hand: ['power-fire', 'power-water'], bench: [creature('sparky')] } });
    const [first, second] = s.players[0].hand;
    const a = act(s, 0, { type: 'ATTACH_POWER', iid: first!.iid, target: { zone: 'bench', index: 0 } });
    expect(a.state.players[0].bench[0]!.attached).toHaveLength(1);
    expect(rejected(a.state, 0, { type: 'ATTACH_POWER', iid: second!.iid, target: { zone: 'active' } })).toBe(
      'POWER_ALREADY_ATTACHED',
    );
  });

  it('rejects non-power cards and bad targets', () => {
    const s = makeState({ p0: { hand: ['potion', 'power-fire'] } });
    const [potion, power] = s.players[0].hand;
    expect(rejected(s, 0, { type: 'ATTACH_POWER', iid: potion!.iid, target: { zone: 'active' } })).toBe('NOT_POWER');
    expect(rejected(s, 0, { type: 'ATTACH_POWER', iid: power!.iid, target: { zone: 'bench', index: 3 } })).toBe(
      'INVALID_TARGET',
    );
  });
});

describe('EVOLVE', () => {
  const evolvable = () =>
    makeState({
      turn: 5,
      p0: {
        active: creature('sparky', { damage: 20, attached: ['power-lightning'], playedOnTurn: 1 }),
        hand: ['sparkling'],
      },
    });

  it('keeps damage and attached cards, and uses the new card from then on', () => {
    const s = evolvable();
    const { state, events } = act(s, 0, { type: 'EVOLVE', iid: s.players[0].hand[0]!.iid, target: { zone: 'active' } });
    const c = state.players[0].active!;
    expect(c.stack.map((x) => x.cardId)).toEqual(['sparky', 'sparkling']);
    expect(c.damage).toBe(20);
    expect(c.attached).toHaveLength(1);
    expect(state.players[0].hand).toHaveLength(0);
    expect(eventsOfType(events, 'EVOLVED')).toHaveLength(1);
  });

  it('a creature cannot evolve the turn it was played', () => {
    const s = makeState({
      turn: 5,
      p0: { active: creature('sparky', { playedOnTurn: 5 }), hand: ['sparkling'] },
    });
    expect(rejected(s, 0, { type: 'EVOLVE', iid: s.players[0].hand[0]!.iid, target: { zone: 'active' } })).toBe(
      'JUST_PLAYED',
    );
  });

  it('requires the right lineage and stage', () => {
    const wrongLine = makeState({ p0: { active: creature('flameling'), hand: ['sparkling'] } });
    expect(rejected(wrongLine, 0, { type: 'EVOLVE', iid: wrongLine.players[0].hand[0]!.iid, target: { zone: 'active' } })).toBe(
      'WRONG_EVOLUTION',
    );
    const skipStage = makeState({ p0: { active: creature('sparky'), hand: ['sparkzilla'] } });
    expect(rejected(skipStage, 0, { type: 'EVOLVE', iid: skipStage.players[0].hand[0]!.iid, target: { zone: 'active' } })).toBe(
      'WRONG_EVOLUTION',
    );
    const basic = makeState({ p0: { active: creature('sparky'), hand: ['sparky'] } });
    expect(rejected(basic, 0, { type: 'EVOLVE', iid: basic.players[0].hand[0]!.iid, target: { zone: 'active' } })).toBe(
      'NOT_EVOLUTION',
    );
  });

  it('stage 2 evolves a stage 1, also on the bench', () => {
    const s = makeState({
      p0: { bench: [creature('sparkling', { stack: ['sparky', 'sparkling'] })], hand: ['sparkzilla'] },
    });
    const { state } = act(s, 0, { type: 'EVOLVE', iid: s.players[0].hand[0]!.iid, target: { zone: 'bench', index: 0 } });
    expect(state.players[0].bench[0]!.stack).toHaveLength(3);
  });

  it('clears status and poison', () => {
    const s = makeState({
      p0: { active: creature('sparky', { status: 'asleep', poisoned: true }), hand: ['sparkling'] },
    });
    const { state } = act(s, 0, { type: 'EVOLVE', iid: s.players[0].hand[0]!.iid, target: { zone: 'active' } });
    expect(state.players[0].active!.status).toBeNull();
    expect(state.players[0].active!.poisoned).toBe(false);
  });

  it('cannot evolve twice in one turn (assumption)', () => {
    const s = makeState({ p0: { active: creature('sparky'), hand: ['sparkling', 'sparkzilla'] } });
    const a = act(s, 0, { type: 'EVOLVE', iid: iidOf(s.players[0].hand, 'sparkling'), target: { zone: 'active' } });
    expect(rejected(a.state, 0, { type: 'EVOLVE', iid: iidOf(a.state.players[0].hand, 'sparkzilla'), target: { zone: 'active' } })).toBe(
      'ALREADY_EVOLVED',
    );
  });
});

describe('PLAY_ITEM and USE_ABILITY', () => {
  it('potion heals, is discarded, and items are not limited per turn', () => {
    const s = makeState({ p0: { active: creature('sparky', { damage: 30 }), hand: ['potion', 'potion'] } });
    const [a, b] = s.players[0].hand;
    const one = act(s, 0, { type: 'PLAY_ITEM', iid: a!.iid, params: { target: { zone: 'active' } } });
    expect(one.state.players[0].active!.damage).toBe(10);
    expect(one.state.players[0].discard).toHaveLength(1);
    const two = act(one.state, 0, { type: 'PLAY_ITEM', iid: b!.iid, params: { target: { zone: 'active' } } });
    expect(two.state.players[0].active!.damage).toBe(0);
    expect(eventsOfType(two.events, 'CREATURE_HEALED')[0]!.amount).toBe(10);
  });

  it('rejects a bad target without changing anything, and unknown effects', () => {
    const s = makeState({ p0: { hand: ['potion', 'mystery', 'sparky'] } });
    const hand = s.players[0].hand;
    expect(rejected(s, 0, { type: 'PLAY_ITEM', iid: hand[0]!.iid, params: { target: { zone: 'bench', index: 2 } } })).toBe(
      'INVALID_TARGET',
    );
    expect(rejected(s, 0, { type: 'PLAY_ITEM', iid: hand[1]!.iid })).toBe('UNKNOWN_EFFECT');
    expect(rejected(s, 0, { type: 'PLAY_ITEM', iid: hand[2]!.iid })).toBe('NOT_ITEM');
  });

  it('draw effect draws from the deck', () => {
    const s = makeState({ p0: { hand: ['draw-two'], deck: 5 } });
    const { state } = act(s, 0, { type: 'PLAY_ITEM', iid: s.players[0].hand[0]!.iid });
    expect(state.players[0].hand).toHaveLength(2);
    expect(state.players[0].deck).toHaveLength(3);
  });

  it('abilities run their handler; creatures without one are rejected', () => {
    const s = makeState({ p0: { active: creature('healer'), bench: [creature('sparky', { damage: 30 })] } });
    const { state } = act(s, 0, {
      type: 'USE_ABILITY',
      target: { zone: 'active' },
      params: { target: { zone: 'bench', index: 0 } },
    });
    expect(state.players[0].bench[0]!.damage).toBe(20);
    expect(rejected(s, 0, { type: 'USE_ABILITY', target: { zone: 'bench', index: 0 } })).toBe('NO_ABILITY');
  });
});

describe('RETREAT', () => {
  const base = () =>
    makeState({
      p0: {
        active: creature('sparky', { attached: ['power-fire', 'power-lightning'] }),
        bench: [creature('bruiser')],
      },
    });

  it('discards the chosen power cards and swaps with the bench', () => {
    const s = base();
    const fire = iidOf(s.players[0].active!.attached, 'power-fire');
    const { state } = act(s, 0, { type: 'RETREAT', benchIndex: 0, discard: [fire] });
    expect(state.players[0].active!.stack[0]!.cardId).toBe('bruiser');
    expect(state.players[0].bench[0]!.stack[0]!.cardId).toBe('sparky');
    expect(state.players[0].bench[0]!.attached).toHaveLength(1);
    expect(state.players[0].discard.map((c) => c.cardId)).toEqual(['power-fire']);
  });

  it('requires exactly enough power cards: not too few, not too many', () => {
    const s = base();
    const all = s.players[0].active!.attached.map((c) => c.iid);
    expect(rejected(s, 0, { type: 'RETREAT', benchIndex: 0, discard: [] })).toBe('INVALID_PAYMENT');
    expect(rejected(s, 0, { type: 'RETREAT', benchIndex: 0, discard: all })).toBe('INVALID_PAYMENT');
    expect(rejected(s, 0, { type: 'RETREAT', benchIndex: 5, discard: [all[0]!] })).toBe('INVALID_BENCH');
  });

  it('a double neutral card pays 2, and may be used to pay 1', () => {
    const two = makeState({
      p0: { active: creature('sparkling', { attached: ['power-double-neutral'] }), bench: [creature('bruiser')] },
    });
    const dn = two.players[0].active!.attached[0]!.iid;
    expect(act(two, 0, { type: 'RETREAT', benchIndex: 0, discard: [dn] }).state.players[0].active!.stack[0]!.cardId).toBe(
      'bruiser',
    );
    const one = makeState({
      p0: { active: creature('sparky', { attached: ['power-double-neutral'] }), bench: [creature('bruiser')] },
    });
    const dn1 = one.players[0].active!.attached[0]!.iid;
    expect(act(one, 0, { type: 'RETREAT', benchIndex: 0, discard: [dn1] }).state.players[0].active!.stack[0]!.cardId).toBe(
      'bruiser',
    );
  });

  it('free retreat: no discards allowed, and retreating twice in a turn is fine', () => {
    const s = makeState({
      p0: { active: creature('bruiser', { attached: ['power-fire'] }), bench: [creature('bruiser')] },
    });
    const fire = s.players[0].active!.attached[0]!.iid;
    expect(rejected(s, 0, { type: 'RETREAT', benchIndex: 0, discard: [fire] })).toBe('INVALID_PAYMENT');
    const a = act(s, 0, { type: 'RETREAT', benchIndex: 0, discard: [] });
    const b = act(a.state, 0, { type: 'RETREAT', benchIndex: 0, discard: [] });
    expect(b.state.players[0].active!.attached).toHaveLength(1);
  });

  it('asleep or paralyzed creatures cannot retreat', () => {
    for (const [status, code] of [['asleep', 'ASLEEP'], ['paralyzed', 'PARALYZED']] as const) {
      const s = makeState({ p0: { active: creature('bruiser', { status }), bench: [creature('bruiser')] } });
      expect(rejected(s, 0, { type: 'RETREAT', benchIndex: 0, discard: [] })).toBe(code);
    }
  });

  it('a successful retreat clears status and poison; confused needs a heads', () => {
    const heads = makeState({
      flips: [true],
      p0: { active: creature('bruiser', { status: 'confused', poisoned: true }), bench: [creature('wimp')] },
    });
    const { state } = act(heads, 0, { type: 'RETREAT', benchIndex: 0, discard: [] });
    expect(state.players[0].active!.stack[0]!.cardId).toBe('wimp');
    expect(state.players[0].bench[0]!.status).toBeNull();
    expect(state.players[0].bench[0]!.poisoned).toBe(false);

    const tails = makeState({
      flips: [false],
      p0: {
        active: creature('sparky', { status: 'confused', attached: ['power-fire'] }),
        bench: [creature('bruiser')],
      },
    });
    const fire = tails.players[0].active!.attached[0]!.iid;
    const r = act(tails, 0, { type: 'RETREAT', benchIndex: 0, discard: [fire] });
    expect(r.state.players[0].active!.stack[0]!.cardId).toBe('sparky'); // did not retreat
    expect(r.state.players[0].active!.attached).toHaveLength(0); // but paid the cost
    expect(r.state.players[0].active!.status).toBe('confused');
    expect(eventsOfType(r.events, 'RETREAT_FAILED')).toHaveLength(1);
  });
});
