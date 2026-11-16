import { describe, expect, it } from 'vitest';
import { act, creature, eventsOfType, makeState, rejected } from './helpers.js';

/** Oddball attack indexes: 0 Lullaby(asleep) 1 Stun(paralyzed) 2 Dizzy(confused) 3 Venom(poison) 4 Gamble(2 heads: poison). */
const oddball = () => creature('oddball', { attached: ['power-fire'] });

describe('attack effects', () => {
  it('Stun paralyzes, Dizzy confuses, Venom poisons', () => {
    const stun = act(makeState({ p0: { active: oddball() } }), 0, { type: 'ATTACK', attackIndex: 1 });
    expect(stun.state.players[1].active!.status).toBe('paralyzed');
    const dizzy = act(makeState({ p0: { active: oddball() } }), 0, { type: 'ATTACK', attackIndex: 2 });
    expect(dizzy.state.players[1].active!.status).toBe('confused');
    const venom = act(makeState({ p0: { active: oddball() } }), 0, { type: 'ATTACK', attackIndex: 3 });
    expect(venom.state.players[1].active!.poisoned).toBe(true);
  });

  it('a new status replaces the old one, poison stays alongside', () => {
    const s = makeState({
      p0: { active: oddball() },
      p1: { active: creature('bruiser', { status: 'paralyzed', poisoned: true }) },
    });
    const { state } = act(s, 0, { type: 'ATTACK', attackIndex: 2 });
    expect(state.players[1].active!.status).toBe('confused');
    expect(state.players[1].active!.poisoned).toBe(true);
  });

  it('an effect with damage 0 still applies (and there is no damage event)', () => {
    const { state, events } = act(makeState({ flips: [false], p0: { active: oddball() } }), 0, {
      type: 'ATTACK',
      attackIndex: 0,
    });
    expect(state.players[1].active!.status).toBe('asleep'); // tails on the wake-up flip
    expect(eventsOfType(events, 'DAMAGE')).toHaveLength(0);
  });

  it('coin conditions: all flips must succeed', () => {
    const both = act(makeState({ flips: [true, true], p0: { active: oddball() } }), 0, { type: 'ATTACK', attackIndex: 4 });
    expect(both.state.players[1].active!.poisoned).toBe(true);
    const one = act(makeState({ flips: [true, false], p0: { active: oddball() } }), 0, { type: 'ATTACK', attackIndex: 4 });
    expect(one.state.players[1].active!.poisoned).toBe(false);
    expect(eventsOfType(one.events, 'COIN_FLIP')).toHaveLength(2);
  });

  it('Ember confuses only on heads', () => {
    const attacker = () => creature('flameling', { attached: ['power-fire', 'power-fire'] });
    const heads = act(makeState({ flips: [true], p0: { active: attacker() } }), 0, { type: 'ATTACK', attackIndex: 0 });
    expect(heads.state.players[1].active!.status).toBe('confused');
    const tails = act(makeState({ flips: [false], p0: { active: attacker() } }), 0, { type: 'ATTACK', attackIndex: 0 });
    expect(tails.state.players[1].active!.status).toBeNull();
  });

  it('no effect on a creature that was knocked out', () => {
    const s = makeState({
      p0: { active: oddball() },
      p1: { active: creature('wimp', { damage: 15 }), bench: [creature('sparky')] },
    });
    const { events } = act(s, 0, { type: 'ATTACK', attackIndex: 3 });
    expect(eventsOfType(events, 'STATUS_APPLIED')).toHaveLength(0);
  });
});

describe('between-turns checkup', () => {
  it('poison deals 10 damage to every poisoned active creature at each checkup', () => {
    const s = makeState({
      p0: { active: creature('bruiser', { poisoned: true }) },
      p1: { active: creature('bruiser', { poisoned: true }) },
    });
    const a = act(s, 0, { type: 'END_TURN' });
    expect(a.state.players[0].active!.damage).toBe(10);
    expect(a.state.players[1].active!.damage).toBe(10);
    const b = act(a.state, 1, { type: 'END_TURN' });
    expect(b.state.players[0].active!.damage).toBe(20);
    expect(eventsOfType(b.events, 'DAMAGE').every((e) => e.source === 'poison')).toBe(true);
  });

  it('a poison knockout gives the opponent a prize and a promotion follows', () => {
    const s = makeState({
      p0: { active: creature('bruiser') },
      p1: { active: creature('wimp', { damage: 15, poisoned: true }), bench: [creature('sparky')] },
    });
    const a = act(s, 0, { type: 'END_TURN' });
    expect(a.state.players[1].active).toBeNull();
    expect(a.state.players[0].prizes).toHaveLength(5);
    expect(a.state.pendingDecisions).toEqual([{ player: 1, type: 'PROMOTE_ACTIVE' }]);
    expect(a.state.turn).toBe(5); // the next turn waits for the promotion
    const b = act(a.state, 1, { type: 'PROMOTE', benchIndex: 0 });
    expect(b.state.turn).toBe(6);
    expect(b.state.currentPlayer).toBe(1);
  });

  it('asleep: heads wakes up at the checkup, tails stays asleep', () => {
    const asleep = () => makeState({ p1: { active: creature('bruiser', { status: 'asleep' }) } });
    const wake = act({ ...asleep(), rngState: makeState({ flips: [true] }).rngState }, 0, { type: 'END_TURN' });
    expect(wake.state.players[1].active!.status).toBeNull();
    const stay = act({ ...asleep(), rngState: makeState({ flips: [false] }).rngState }, 0, { type: 'END_TURN' });
    expect(stay.state.players[1].active!.status).toBe('asleep');
  });

  it('an asleep creature cannot attack or retreat during its turn', () => {
    const s = makeState({
      flips: [false],
      p1: {
        active: creature('bruiser', { status: 'asleep', attached: ['power-fire'] }),
        bench: [creature('bruiser')],
      },
    });
    const a = act(s, 0, { type: 'END_TURN' }); // p1 flips before their turn: tails
    expect(rejected(a.state, 1, { type: 'ATTACK', attackIndex: 0 })).toBe('ASLEEP');
    expect(rejected(a.state, 1, { type: 'RETREAT', benchIndex: 0, discard: [] })).toBe('ASLEEP');
  });

  it('there is no wake-up flip at the end of the sleeper\'s own turn, only before their next one', () => {
    const s = makeState({
      flips: [false, true],
      p1: { active: creature('bruiser', { status: 'asleep' }) },
    });
    const a = act(s, 0, { type: 'END_TURN' }); // flip 1 (tails) before p1's turn
    const b = act(a.state, 1, { type: 'END_TURN' }); // p1 ends their turn: no flip
    expect(eventsOfType(b.events, 'COIN_FLIP')).toHaveLength(0);
    expect(b.state.players[1].active!.status).toBe('asleep');
    const c = act(b.state, 0, { type: 'END_TURN' }); // flip 2 (heads) before p1's next turn
    expect(c.state.players[1].active!.status).toBeNull();
  });

  it('paralysis lasts through the paralyzed player\'s next turn, then wears off', () => {
    const s = makeState({
      p0: { active: oddball() },
      p1: { active: creature('bruiser', { attached: ['power-fire'] }), bench: [creature('bruiser')] },
    });
    const a = act(s, 0, { type: 'ATTACK', attackIndex: 1 }); // Stun
    expect(a.state.players[1].active!.status).toBe('paralyzed'); // survives the checkup
    expect(rejected(a.state, 1, { type: 'ATTACK', attackIndex: 0 })).toBe('PARALYZED');
    expect(rejected(a.state, 1, { type: 'RETREAT', benchIndex: 0, discard: [] })).toBe('PARALYZED');
    const b = act(a.state, 1, { type: 'END_TURN' });
    expect(b.state.players[1].active!.status).toBeNull(); // cleared after their turn
    const c = act(b.state, 0, { type: 'END_TURN' });
    expect(act(c.state, 1, { type: 'ATTACK', attackIndex: 0 }).state.players[0].active!.damage).toBe(30);
  });
});

describe('confusion', () => {
  const confusedNarcissus = (flips: boolean[], damage = 0) =>
    makeState({
      flips,
      p0: {
        active: creature('narcissus', { status: 'confused', attached: ['power-fire'], damage }),
        bench: [creature('sparky')],
      },
    });

  it('tails: no attack, 20 self-damage with weakness applied, turn ends', () => {
    const { state, events } = act(confusedNarcissus([false]), 0, { type: 'ATTACK', attackIndex: 0 });
    expect(state.players[1].active!.damage).toBe(0);
    expect(state.players[0].active!.damage).toBe(40); // 20 x2: Narcissus is weak to its own nature
    expect(eventsOfType(events, 'DAMAGE')[0]!.source).toBe('confusion');
    expect(state.currentPlayer).toBe(1);
  });

  it('tails without weakness: exactly 20 damage', () => {
    const s = makeState({
      flips: [false],
      p0: { active: creature('bruiser', { status: 'confused', attached: ['power-fire'] }) },
    });
    expect(act(s, 0, { type: 'ATTACK', attackIndex: 0 }).state.players[0].active!.damage).toBe(20);
  });

  it('heads: the attack goes through and the creature stays confused', () => {
    const { state } = act(confusedNarcissus([true]), 0, { type: 'ATTACK', attackIndex: 0 });
    expect(state.players[1].active!.damage).toBe(10);
    expect(state.players[0].active!.damage).toBe(0);
    expect(state.players[0].active!.status).toBe('confused');
  });

  it('can knock itself out, giving the opponent the prize', () => {
    const { state } = act(confusedNarcissus([false], 70), 0, { type: 'ATTACK', attackIndex: 0 });
    expect(state.players[0].active).toBeNull();
    expect(state.players[1].prizes).toHaveLength(5);
    expect(state.pendingDecisions).toEqual([{ player: 0, type: 'PROMOTE_ACTIVE' }]);
  });

  it('power cost is checked before the coin is flipped', () => {
    const s = makeState({ flips: [true], p0: { active: creature('narcissus', { status: 'confused' }) } });
    expect(rejected(s, 0, { type: 'ATTACK', attackIndex: 0 })).toBe('NOT_ENOUGH_POWER');
  });
});
