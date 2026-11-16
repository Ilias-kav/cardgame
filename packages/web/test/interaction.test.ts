import { starterCatalog, type CreatureInPlay } from '@cardgame/engine';
import type { PlayerView } from '@cardgame/protocol';
import { describe, expect, it } from 'vitest';
import {
  NONE,
  beginAbilityTarget,
  beginPicking,
  beginRetreat,
  clickHandCard,
  clickMyCreature,
  creatureHasTargetedAbility,
  handCardNeedsTarget,
  targetsFor,
  toggleDiscard,
  validateSelection,
  type Selection,
} from '../src/game/interaction.js';
import { playingState, viewOf } from './helpers.js';

const catalog = starterCatalog;
const inPlay = (cardId: string, o: Partial<CreatureInPlay> = {}): CreatureInPlay => ({
  stack: [{ iid: `s-${cardId}`, cardId }],
  attached: o.attached ?? [],
  damage: o.damage ?? 0,
  status: null,
  poisoned: false,
  playedOnTurn: o.playedOnTurn ?? 0,
  evolvedOnTurn: 0,
});
const hand = (...cardIds: string[]) => cardIds.map((cardId, i) => ({ iid: `h${i}`, cardId }));

function view(o: Partial<PlayerView['you']> = {}, extra: Partial<PlayerView> = {}): PlayerView {
  const state = playingState();
  const base = viewOf(state, state.currentPlayer);
  return { ...base, turn: 5, you: { ...base.you, active: inPlay('embercub'), bench: [inPlay('pondling'), inPlay('sproutle')], hand: [], ...o }, ...extra };
}

describe('hand cards', () => {
  it('selecting toggles', () => {
    const s = clickHandCard(NONE, 'h0').selection;
    expect(s).toEqual({ kind: 'hand', iid: 'h0', picking: false });
    expect(clickHandCard(s, 'h0').selection).toEqual(NONE);
    expect(clickHandCard(s, 'h1').selection).toEqual({ kind: 'hand', iid: 'h1', picking: false });
  });

  it('which cards need a target creature', () => {
    expect(handCardNeedsTarget(catalog, 'power-fire')).toBe(true);
    expect(handCardNeedsTarget(catalog, 'blazewolf')).toBe(true); // evolution
    expect(handCardNeedsTarget(catalog, 'potion')).toBe(true);
    expect(handCardNeedsTarget(catalog, 'quick-draw')).toBe(false);
    expect(handCardNeedsTarget(catalog, 'embercub')).toBe(true); // a basic is "played", but the check says creature
  });
});

describe('attaching, evolving, using items', () => {
  it('attach: highlights all my creatures, then sends ATTACH_POWER to the clicked one', () => {
    const v = view({ hand: hand('power-fire') });
    const sel = beginPicking(clickHandCard(NONE, 'h0').selection);
    expect(targetsFor(v, catalog, sel)).toEqual([{ zone: 'active' }, { zone: 'bench', index: 0 }, { zone: 'bench', index: 1 }]);
    const r = clickMyCreature(v, catalog, sel, { zone: 'bench', index: 1 });
    expect(r.action).toEqual({ type: 'ATTACH_POWER', iid: 'h0', target: { zone: 'bench', index: 1 } });
    expect(r.selection).toEqual(NONE);
  });

  it('evolve: only valid creatures are targets; clicking another explains why', () => {
    const v = view({ hand: hand('blazewolf'), active: inPlay('embercub', { playedOnTurn: 1 }) });
    const sel = beginPicking(clickHandCard(NONE, 'h0').selection);
    expect(targetsFor(v, catalog, sel)).toEqual([{ zone: 'active' }]);
    expect(clickMyCreature(v, catalog, sel, { zone: 'active' }).action).toEqual({
      type: 'EVOLVE',
      iid: 'h0',
      target: { zone: 'active' },
    });
    const bad = clickMyCreature(v, catalog, sel, { zone: 'bench', index: 0 });
    expect(bad.action).toBeUndefined();
    expect(bad.message).toContain('cannot evolve into Blazewolf');
    expect(bad.selection).toEqual(sel); // stays in picking mode
  });

  it('a healing item is played on the chosen creature', () => {
    const v = view({ hand: hand('potion') });
    const sel = beginPicking(clickHandCard(NONE, 'h0').selection);
    const r = clickMyCreature(v, catalog, sel, { zone: 'active' });
    expect(r.action).toEqual({ type: 'PLAY_ITEM', iid: 'h0', params: { target: { zone: 'active' } } });
  });

  it('beginPicking only affects hand selections', () => {
    expect(beginPicking(NONE)).toEqual(NONE);
  });
});

describe('selecting creatures', () => {
  it('clicking selects, clicking again deselects', () => {
    const v = view();
    const a = clickMyCreature(v, catalog, NONE, { zone: 'active' }).selection;
    expect(a).toMatchObject({ kind: 'creature', mode: 'menu' });
    expect(clickMyCreature(v, catalog, a, { zone: 'active' }).selection).toEqual(NONE);
    const b = clickMyCreature(v, catalog, a, { zone: 'bench', index: 0 }).selection;
    expect(b).toMatchObject({ kind: 'creature', ref: { zone: 'bench', index: 0 } });
  });

  it('abilities that need a target: choose the target next', () => {
    const v = view({ active: inPlay('mender'), bench: [inPlay('pondling', { damage: 10 })] });
    expect(creatureHasTargetedAbility(catalog, v, { zone: 'active' })).toBe(true);
    expect(creatureHasTargetedAbility(catalog, view(), { zone: 'active' })).toBe(false);
    const sel = beginAbilityTarget(clickMyCreature(v, catalog, NONE, { zone: 'active' }).selection);
    expect(targetsFor(v, catalog, sel)).toHaveLength(2);
    const r = clickMyCreature(v, catalog, sel, { zone: 'bench', index: 0 });
    expect(r.action).toEqual({ type: 'USE_ABILITY', target: { zone: 'active' }, params: { target: { zone: 'bench', index: 0 } } });
  });
});

describe('retreat flow', () => {
  const armed = () =>
    view({ active: inPlay('blazewolf', { attached: [{ iid: 'a0', cardId: 'power-fire' }, { iid: 'a1', cardId: 'power-fire' }, { iid: 'a2', cardId: 'power-water' }] }) });

  it('choose the replacement on the bench and toggle which power cards to discard', () => {
    const v = armed();
    let sel: Selection = clickMyCreature(v, catalog, NONE, { zone: 'active' }).selection;
    sel = beginRetreat(sel);
    expect(sel).toMatchObject({ mode: 'retreat', discard: [], benchIndex: null });
    expect(targetsFor(v, catalog, sel)).toEqual([{ zone: 'bench', index: 0 }, { zone: 'bench', index: 1 }]);

    sel = clickMyCreature(v, catalog, sel, { zone: 'bench', index: 1 }).selection;
    expect(sel).toMatchObject({ benchIndex: 1 });
    sel = clickMyCreature(v, catalog, sel, { zone: 'bench', index: 1 }).selection; // again: un-choose
    expect(sel).toMatchObject({ benchIndex: null });
    expect(clickMyCreature(v, catalog, sel, { zone: 'active' }).selection).toBe(sel); // active is not a choice

    sel = toggleDiscard(sel, 'a0');
    sel = toggleDiscard(sel, 'a2');
    expect(sel).toMatchObject({ discard: ['a0', 'a2'] });
    expect(toggleDiscard(sel, 'a0')).toMatchObject({ discard: ['a2'] });
  });

  it('toggleDiscard does nothing outside the retreat step', () => {
    expect(toggleDiscard(NONE, 'a0')).toEqual(NONE);
  });
});

describe('promotion', () => {
  const promoting = () => {
    const v = view({ active: null });
    return { ...v, pendingDecisions: [{ player: v.seat, type: 'PROMOTE_ACTIVE' as const }] };
  };

  it('highlights the bench and a click sends PROMOTE', () => {
    const v = promoting();
    expect(targetsFor(v, catalog, NONE)).toEqual([{ zone: 'bench', index: 0 }, { zone: 'bench', index: 1 }]);
    expect(clickMyCreature(v, catalog, NONE, { zone: 'bench', index: 1 })).toEqual({
      selection: NONE,
      action: { type: 'PROMOTE', benchIndex: 1 },
    });
    expect(clickMyCreature(v, catalog, NONE, { zone: 'active' }).message).toContain('bench');
  });
});

describe('validateSelection', () => {
  it('drops selections whose card or creature disappeared', () => {
    const v = view({ hand: hand('potion') });
    expect(validateSelection(v, { kind: 'hand', iid: 'h0', picking: true })).toEqual({ kind: 'hand', iid: 'h0', picking: true });
    expect(validateSelection(v, { kind: 'hand', iid: 'gone', picking: false })).toEqual(NONE);
    expect(validateSelection(v, { kind: 'creature', ref: { zone: 'bench', index: 5 }, mode: 'menu', discard: [], benchIndex: null })).toEqual(NONE);
  });

  it('forgets retreat choices that are no longer valid', () => {
    const v = view({ active: inPlay('blazewolf', { attached: [{ iid: 'a0', cardId: 'power-fire' }] }) });
    const sel: Selection = { kind: 'creature', ref: { zone: 'active' }, mode: 'retreat', discard: ['a0', 'zz'], benchIndex: 9 };
    expect(validateSelection(v, sel)).toEqual({ ...sel, discard: ['a0'], benchIndex: null });
  });
});
